import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import drive from '@adonisjs/drive/services/main'
import limiter from '@adonisjs/limiter/services/main'
import db from '@adonisjs/lucid/services/db'
import { readFile } from 'node:fs/promises'
import { DateTime } from 'luxon'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import Message from '#models/message'
import MessageAttachment from '#models/message_attachment'
import MessageUrl from '#models/message_url'
import ModerationCase from '#models/moderation_case'
import { fakeMalwareScanner } from '#services/attachment_scanner'
import { scanAttachment } from '#services/attachment_service'
import { analyzeHeldMessage } from '#services/message_analysis_service'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import { clearDomainListCache } from '#services/moderation/url/domain_registry'
import { resetUrlAnalysisFakes } from '#services/url_analysis_service'
import { signupAs } from '#tests/helpers/vendors'
import {
  activeVendor,
  dataOf,
  messagePayload,
  startInquiry,
  verifiedCustomer,
} from '#tests/helpers/messaging'

const STEP = Buffer.from("ISO-10303-21;\nHEADER;\nFILE_NAME('bracket.step');\nENDSEC;\n")

test.group('Messaging: attachments', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    drive.fake('s3')
    clearRuleConfigCache()
    clearDomainListCache()
    resetUrlAnalysisFakes()
    fakeMalwareScanner.reset()
    return async () => {
      drive.restore('s3')
      clearRuleConfigCache()
      clearDomainListCache()
      resetUrlAnalysisFakes()
      fakeMalwareScanner.reset()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  async function inquiryBetween(client: any) {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const started = await startInquiry(client, customer.session, vendor.vendor)
    started.assertStatus(201)
    return { customer, vendor, uuid: dataOf(started).conversation.uuid as string }
  }

  /** Steps 1-3 of the flow: presign, "PUT" the bytes to quarantine, confirm. */
  async function upload(client: any, session: any, uuid: string, fileName: string, bytes: Buffer) {
    const created = await client
      .post(`/v1/conversations/${uuid}/attachments`)
      .withSession(session)
      .json({ fileName, sizeBytes: bytes.length })
    created.assertStatus(201)
    const attachment = await MessageAttachment.findByOrFail('uuid', dataOf(created).attachment.uuid)
    await drive.use('s3').put(attachment.quarantineKey, bytes)

    const completed = await client
      .post(`/v1/conversations/${uuid}/attachments/${attachment.uuid}/complete`)
      .withSession(session)
    completed.assertStatus(200)
    await attachment.refresh()
    return attachment
  }

  async function sendWith(client: any, session: any, uuid: string, uuids: string[], body = '') {
    const response = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(session)
      .json({ ...messagePayload(body), attachmentUuids: uuids })
    response.assertStatus(201)
    return dataOf(response)
  }

  test('a scanned-clean file is promoted, sent and downloadable by the recipient', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const created = await client
      .post(`/v1/conversations/${uuid}/attachments`)
      .withSession(customer.session)
      .json({ fileName: 'bracket.step', sizeBytes: STEP.length })
    assert.equal(dataOf(created).upload.method, 'PUT')
    assert.match(dataOf(created).upload.url, /quarantine\/conversations\//)

    const attachment = await upload(client, customer.session, uuid, 'bracket.step', STEP)
    assert.equal(attachment.status, 'uploaded')
    const jobs = await db
      .from('queue_jobs')
      .where('data', 'like', `%"attachmentId":${attachment.id}%`)
    assert.lengthOf(jobs, 1)

    await scanAttachment(attachment.id)
    await attachment.refresh()
    assert.equal(attachment.status, 'clean')
    assert.match(attachment.storageKey!, /^projects\/conversations\/.+\.step$/)
    assert.isTrue(await drive.use('s3').exists(attachment.storageKey!))
    assert.isFalse(await drive.use('s3').exists(attachment.quarantineKey))

    const sent = await sendWith(
      client,
      customer.session,
      uuid,
      [attachment.uuid],
      'Drawing attached'
    )
    assert.equal(sent.status, 'delivered')

    const vendorView = await client
      .get(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
    const message = dataOf(vendorView).find((m: any) => m.uuid === sent.uuid)
    assert.deepInclude(message.attachments[0], { fileName: 'bracket.step', available: true })

    const download = await client
      .get(`/v1/conversations/${uuid}/attachments/${attachment.uuid}`)
      .withSession(vendor.session)
    download.assertStatus(200)
    assert.match(dataOf(download).downloadUrl, /signed/)
  })

  test('sent while still scanning: held, then delivered when the scan finishes', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const attachment = await upload(
      client,
      customer.session,
      uuid,
      'part.stl',
      Buffer.from('solid part\nendsolid')
    )
    const sent = await sendWith(client, customer.session, uuid, [attachment.uuid])
    assert.equal(sent.status, 'held')

    // Nobody else can fetch it while the message is held.
    const early = await client
      .get(`/v1/conversations/${uuid}/attachments/${attachment.uuid}`)
      .withSession(vendor.session)
    early.assertStatus(404)

    await scanAttachment(attachment.id)
    const message = await Message.findByOrFail('uuid', sent.uuid)
    const resumed = await db.from('queue_jobs').where('dedup_id', 'like', `%analyze-${message.id}`)
    assert.lengthOf(resumed, 1)
    await analyzeHeldMessage(message.id)
    await message.refresh()
    assert.equal(message.status, 'delivered')
  })

  test('malware is rejected and blocks the message carrying it', async ({ client, assert }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const attachment = await upload(
      client,
      customer.session,
      uuid,
      'part.stl',
      Buffer.from('solid part\nendsolid')
    )
    const sent = await sendWith(client, customer.session, uuid, [attachment.uuid], 'see file')
    fakeMalwareScanner.results.set(attachment.quarantineKey, 'infected')

    await scanAttachment(attachment.id)
    await attachment.refresh()
    assert.equal(attachment.status, 'rejected')
    assert.equal(attachment.rejectReason, 'malware')
    assert.isNull(attachment.storageKey)
    assert.isFalse(await drive.use('s3').exists(attachment.quarantineKey))

    const message = await Message.findByOrFail('uuid', sent.uuid)
    await analyzeHeldMessage(message.id)
    await message.refresh()
    assert.equal(message.status, 'blocked')
    assert.match(message.userFacingReason!, /security checks/)
  })

  test('a PDF with JavaScript is rejected; a rejected file cannot be sent', async ({
    client,
    assert,
  }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const doc = await PDFDocument.create()
    doc.addPage()
    doc.addJavaScript('x', 'app.launchURL("https://evil.example.net")')
    const attachment = await upload(
      client,
      customer.session,
      uuid,
      'drawing.pdf',
      Buffer.from(await doc.save())
    )
    await scanAttachment(attachment.id)
    await attachment.refresh()
    assert.equal(attachment.rejectReason, 'pdf_active_content')

    const refused = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(customer.session)
      .json({ ...messagePayload('here'), attachmentUuids: [attachment.uuid] })
    refused.assertStatus(422)
  })

  test("a QR code's link goes through the link checks", async ({ client, assert }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const qr = await readFile('tests/fixtures/attachments/qr_link.png')
    const attachment = await upload(client, customer.session, uuid, 'scan-me.png', qr)
    await scanAttachment(attachment.id)

    const sent = await sendWith(client, customer.session, uuid, [attachment.uuid], 'Scan to pay')
    assert.equal(sent.status, 'held')
    const message = await Message.findByOrFail('uuid', sent.uuid)
    const link = await MessageUrl.findByOrFail('messageId', message.id)
    assert.equal(link.normalizedUrl, 'https://pay-here.example.net/invoice')
    assert.equal(link.source, 'attachment')
  })

  test('no scanner verdict in time: a person checks, and approval releases the file', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    const image = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#888' },
    })
      .jpeg()
      .toBuffer()
    const attachment = await upload(client, customer.session, uuid, 'photo.jpg', image)
    fakeMalwareScanner.results.set(attachment.quarantineKey, 'pending')

    // Still waiting: the scan re-queues itself.
    await scanAttachment(attachment.id)
    await attachment.refresh()
    assert.equal(attachment.status, 'uploaded')

    attachment.uploadedAt = DateTime.now().minus({ minutes: 20 })
    await attachment.save()
    await scanAttachment(attachment.id)
    await attachment.refresh()
    assert.equal(attachment.status, 'review')
    assert.equal(attachment.rejectReason, 'malware_pending')

    const sent = await sendWith(
      client,
      customer.session,
      uuid,
      [attachment.uuid],
      'Photo of the part'
    )
    assert.equal(sent.status, 'pending_review')

    const adminDownload = await client
      .get(`/v1/admin/attachments/${attachment.uuid}`)
      .withSession(admin.session)
    adminDownload.assertStatus(200)

    const moderationCase = await ModerationCase.query().where('source', 'auto_hold').firstOrFail()
    const approve = await client
      .post(`/v1/admin/moderation/cases/${moderationCase.uuid}/approve`)
      .withSession(admin.session)
      .json({})
    approve.assertStatus(200)
    await attachment.refresh()
    assert.equal(attachment.status, 'clean')

    const download = await client
      .get(`/v1/conversations/${uuid}/attachments/${attachment.uuid}`)
      .withSession(vendor.session)
    download.assertStatus(200)
  })

  test('uploads are checked: type, size, declared size, ownership', async ({ client }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const outsider = await verifiedCustomer(client)

    const exe = await client
      .post(`/v1/conversations/${uuid}/attachments`)
      .withSession(customer.session)
      .json({ fileName: 'tool.exe', sizeBytes: 100 })
    exe.assertStatus(422)
    const zip = await client
      .post(`/v1/conversations/${uuid}/attachments`)
      .withSession(customer.session)
      .json({ fileName: 'parts.zip', sizeBytes: 100 })
    zip.assertStatus(422)
    const huge = await client
      .post(`/v1/conversations/${uuid}/attachments`)
      .withSession(customer.session)
      .json({ fileName: 'big.stl', sizeBytes: 60 * 1024 * 1024 })
    huge.assertStatus(422)

    const notUploaded = await client
      .post(`/v1/conversations/${uuid}/attachments`)
      .withSession(customer.session)
      .json({ fileName: 'part.stl', sizeBytes: 10 })
    const early = await client
      .post(`/v1/conversations/${uuid}/attachments/${dataOf(notUploaded).attachment.uuid}/complete`)
      .withSession(customer.session)
    early.assertStatus(409)

    const created = await client
      .post(`/v1/conversations/${uuid}/attachments`)
      .withSession(customer.session)
      .json({ fileName: 'part.stl', sizeBytes: 5 })
    const record = await MessageAttachment.findByOrFail('uuid', dataOf(created).attachment.uuid)
    await drive
      .use('s3')
      .put(record.quarantineKey, Buffer.from('solid much longer than five bytes'))
    const mismatch = await client
      .post(`/v1/conversations/${uuid}/attachments/${record.uuid}/complete`)
      .withSession(customer.session)
    mismatch.assertStatus(422)

    const outside = await client
      .post(`/v1/conversations/${uuid}/attachments`)
      .withSession(outsider.session)
      .json({ fileName: 'part.stl', sizeBytes: 10 })
    outside.assertStatus(404)

    // Someone else's upload can't be sent by the other participant.
    const mine = await upload(client, customer.session, uuid, 'part.step', STEP)
    const stolen = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
      .json({ ...messagePayload('here'), attachmentUuids: [mine.uuid] })
    stolen.assertStatus(422)

    const empty = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(customer.session)
      .json(messagePayload(''))
    empty.assertStatus(422)
  })
})
