import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import drive from '@adonisjs/drive/services/main'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'
import MessageAttachment from '#models/message_attachment'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import QuoteItem from '#models/quote_item'
import PurgeExpiredProjects from '#jobs/purge_expired_projects'
import ExpireAbandonedProjects from '#jobs/expire_abandoned_projects'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import {
  activeVendor,
  messagePayload,
  startInquiry,
  verifiedCustomer,
} from '#tests/helpers/messaging'
import { signupAs } from '#tests/helpers/vendors'

function dataOf(response: any) {
  return response.body().data
}

/** A customer, a listed vendor, and an open inquiry between them. */
async function inquiryBetween(client: any) {
  const customer = await verifiedCustomer(client)
  const vendor = await activeVendor(client)
  const started = await startInquiry(client, customer.session, vendor.vendor)
  started.assertStatus(201)
  const conversation = await Conversation.findByOrFail('uuid', dataOf(started).conversation.uuid)
  return { customer, vendor, conversation }
}

/**
 * An attachment the customer sent in the thread, already through its checks
 * (status `clean`, promoted to its served key) - what ScanAttachment leaves
 * behind. `send: false` leaves it uploaded but unsent.
 */
async function sentAttachment(
  client: any,
  session: any,
  conversation: Conversation,
  options: { fileName?: string; status?: MessageAttachment['status']; send?: boolean } = {}
) {
  const participant = await ConversationParticipant.query()
    .where('conversationId', conversation.id)
    .where('role', 'customer')
    .firstOrFail()
  const uuid = string.uuid()
  const extname = (options.fileName ?? 'bracket.stl').split('.').pop()!
  const storageKey = `projects/conversations/${conversation.uuid}/${uuid}.${extname}`
  const bytes = Buffer.from('solid bracket\nendsolid bracket\n')
  const status = options.status ?? 'clean'
  await drive.use('s3').put(storageKey, bytes)
  const attachment = await MessageAttachment.create({
    uuid,
    conversationId: conversation.id,
    uploadedByParticipantId: participant.id,
    fileName: options.fileName ?? 'bracket.stl',
    extname,
    contentType: 'model/stl',
    sizeBytes: bytes.length,
    quarantineKey: `projects/quarantine/conversations/${conversation.uuid}/${uuid}.${extname}`,
    storageKey: status === 'clean' || status === 'review' ? storageKey : null,
    status,
  })
  if (options.send !== false) {
    const sent = await client
      .post(`/v1/conversations/${conversation.uuid}/messages`)
      .withSession(session)
      .json({ ...messagePayload('Here is the part.'), attachmentUuids: [uuid] })
    sent.assertStatus(201)
    await attachment.refresh()
  }
  return attachment
}

function createProject(client: any, session: any, conversation: Conversation, body = {}) {
  return client
    .post(`/v1/vendor/inquiries/${conversation.uuid}/project`)
    .withSession(session)
    .json(body)
}

test.group('Manual projects | from inquiries', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    drive.fake('s3')
    clearRuleConfigCache()
    return async () => {
      drive.restore('s3')
      clearRuleConfigCache()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test("the thread's vendor starts a project and copies in a scanned attachment", async ({
    client,
    assert,
  }) => {
    const { customer, vendor, conversation } = await inquiryBetween(client)
    const attachment = await sentAttachment(client, customer.session, conversation)

    const response = await createProject(client, vendor.session, conversation, {
      attachmentUuids: [attachment.uuid],
    })
    response.assertStatus(201)
    const data = dataOf(response)
    assert.equal(data.source, 'manual')
    assert.equal(data.status, 'draft')
    assert.equal(data.title, 'Bracket run')
    assert.equal(data.conversationUuid, conversation.uuid)
    assert.isString(data.customer.displayName)
    assert.lengthOf(data.files, 1)
    assert.equal(data.files[0].originalName, 'bracket.stl')
    assert.equal(data.files[0].status, 'stored')
    assert.notInclude(JSON.stringify(response.body()), 'projects/')

    const project = await Project.findByOrFail('uuid', data.uuid)
    assert.equal(project.source, 'manual')
    assert.equal(project.vendorId, vendor.vendor.id)
    assert.equal(project.customerId, customer.customer.id)
    assert.equal(project.conversationId, conversation.id)
    await conversation.refresh()
    assert.equal(conversation.projectId, project.id)

    const file = await ProjectFile.findByOrFail('uuid', data.files[0].uuid)
    assert.isNull(file.technology)
    assert.isNull(file.materialId)
    assert.equal(file.messageAttachmentId, attachment.id)
    assert.equal(file.fileStorageKey, `projects/${project.uuid}/${file.uuid}.stl`)
    assert.isTrue(await drive.use('s3').exists(file.fileStorageKey))
    // The original stays where it was - this is a copy.
    assert.isTrue(await drive.use('s3').exists(attachment.storageKey!))

    const download = await client
      .get(`/v1/vendor/projects/${project.uuid}/files/${file.uuid}/download`)
      .withSession(vendor.session)
    download.assertStatus(200)
    assert.isString(dataOf(download).url)
  })

  test("only the thread's own vendor can start a project", async ({ client }) => {
    const { customer, conversation } = await inquiryBetween(client)
    const other = await activeVendor(client, 'Other Shop')

    const response = await createProject(client, other.session, conversation)
    response.assertStatus(404)

    const asCustomer = await createProject(client, customer.session, conversation)
    asCustomer.assertStatus(403)
  })

  test('only attachments that passed every check, sent in this thread, can be copied', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, conversation } = await inquiryBetween(client)
    const underReview = await sentAttachment(client, customer.session, conversation, {
      fileName: 'odd.stl',
      status: 'review',
    })
    const unsent = await sentAttachment(client, customer.session, conversation, {
      fileName: 'draft.stl',
      send: false,
    })
    const elsewhere = await inquiryBetween(client)
    const foreign = await sentAttachment(client, elsewhere.customer.session, elsewhere.conversation)

    for (const [attachment, status] of [
      [underReview, 409],
      [unsent, 409],
      [foreign, 404],
    ] as const) {
      const response = await createProject(client, vendor.session, conversation, {
        attachmentUuids: [attachment.uuid],
      })
      response.assertStatus(status)
    }
    // Nothing was created by the refused requests.
    assert.lengthOf(await Project.query().where('source', 'manual'), 0)
  })

  test('a closed inquiry cannot become a project', async ({ client }) => {
    const { vendor, conversation } = await inquiryBetween(client)
    const declined = await client
      .post(`/v1/vendor/conversations/${conversation.uuid}/decline`)
      .withSession(vendor.session)
      .json({})
    declined.assertStatus(204)

    const response = await createProject(client, vendor.session, conversation)
    response.assertStatus(409)
  })

  test('files can be added later (once each) and removed until quoted', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, conversation } = await inquiryBetween(client)
    const created = await createProject(client, vendor.session, conversation, {
      title: 'Brackets v2',
    })
    const projectUuid = dataOf(created).uuid
    assert.equal(dataOf(created).title, 'Brackets v2')
    assert.lengthOf(dataOf(created).files, 0)

    const first = await sentAttachment(client, customer.session, conversation)
    const second = await sentAttachment(client, customer.session, conversation, {
      fileName: 'mount.step',
    })
    const added = await client
      .post(`/v1/vendor/projects/${projectUuid}/files`)
      .withSession(vendor.session)
      .json({ attachmentUuids: [first.uuid, second.uuid] })
    added.assertStatus(200)
    assert.lengthOf(dataOf(added).files, 2)

    const again = await client
      .post(`/v1/vendor/projects/${projectUuid}/files`)
      .withSession(vendor.session)
      .json({ attachmentUuids: [first.uuid] })
    assert.lengthOf(dataOf(again).files, 2)

    const [quotedFile, freeFile] = await ProjectFile.query()
      .whereHas('project', (query) => query.where('uuid', projectUuid))
      .orderBy('id', 'asc')
    const project = await Project.findByOrFail('uuid', projectUuid)
    const quote = await Quote.create({
      uuid: string.uuid(),
      projectId: project.id,
      revision: 1,
      status: 'draft',
      generatedBy: 'user',
      subtotal: '10.00',
      tax: '0.00',
      total: '10.00',
    })
    await QuoteItem.create({
      quoteId: quote.id,
      projectFileId: quotedFile.id,
      quantity: 1,
      unitPrice: '10.00',
      total: '10.00',
    })

    const blocked = await client
      .delete(`/v1/vendor/projects/${projectUuid}/files/${quotedFile.uuid}`)
      .withSession(vendor.session)
    blocked.assertStatus(409)

    const removed = await client
      .delete(`/v1/vendor/projects/${projectUuid}/files/${freeFile.uuid}`)
      .withSession(vendor.session)
    removed.assertStatus(204)
    assert.isNull(await ProjectFile.find(freeFile.id))
    assert.isFalse(await drive.use('s3').exists(freeFile.fileStorageKey))
  })

  test('one inquiry can lead to several projects; the thread points at the latest', async ({
    client,
    assert,
  }) => {
    const { vendor, conversation } = await inquiryBetween(client)
    const first = await createProject(client, vendor.session, conversation, { title: 'First run' })
    const second = await createProject(client, vendor.session, conversation, {
      title: 'Repeat order',
    })

    await conversation.refresh()
    const latest = await Project.findByOrFail('uuid', dataOf(second).uuid)
    assert.equal(conversation.projectId, latest.id)

    const list = await client.get('/v1/vendor/projects').withSession(vendor.session)
    list.assertStatus(200)
    assert.sameMembers(
      dataOf(list).map((project: any) => project.uuid),
      [dataOf(first).uuid, dataOf(second).uuid]
    )

    const other = await activeVendor(client, 'Other Shop')
    const otherList = await client.get('/v1/vendor/projects').withSession(other.session)
    assert.lengthOf(dataOf(otherList), 0)
    const peek = await client
      .get(`/v1/vendor/projects/${dataOf(first).uuid}`)
      .withSession(other.session)
    peek.assertStatus(404)
  })
})

test.group('Manual projects | kept apart from instant quotes', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    drive.fake('s3')
    clearRuleConfigCache()
    return async () => {
      drive.restore('s3')
      clearRuleConfigCache()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  async function manualProjectWithFile(client: any) {
    const parties = await inquiryBetween(client)
    const attachment = await sentAttachment(client, parties.customer.session, parties.conversation)
    const created = await createProject(client, parties.vendor.session, parties.conversation, {
      attachmentUuids: [attachment.uuid],
    })
    created.assertStatus(201)
    return {
      ...parties,
      projectUuid: dataOf(created).uuid as string,
      fileUuid: dataOf(created).files[0].uuid as string,
    }
  }

  test("the instant-quote endpoints refuse a manual project's files", async ({ client }) => {
    const { customer, projectUuid, fileUuid } = await manualProjectWithFile(client)

    const technology = await client
      .patch(`/v1/projects/files/${fileUuid}/technology`)
      .withSession(customer.session)
      .json({ technology: 'sla' })
    technology.assertStatus(409)

    const quote = await client
      .post(`/v1/projects/${projectUuid}/quotes`)
      .withSession(customer.session)
      .json({ items: [{ projectFileUuid: fileUuid, quantity: 1 }] })
    quote.assertStatus(409)

    const email = await client
      .post(`/v1/projects/${projectUuid}/email`)
      .withSession(customer.session)
      .json({ email: 'someone@test.com' })
    email.assertStatus(409)
  })

  test("only admins and the project's own vendor have staff access to it", async ({ client }) => {
    const { vendor, customer, projectUuid, fileUuid } = await manualProjectWithFile(client)
    const other = await activeVendor(client, 'Other Shop')
    const { session: adminSession } = await signupAs(client, 'admin')

    const path = `/v1/projects/files/${fileUuid}`
    ;(await client.get(path).withSession(other.session)).assertStatus(404)
    ;(
      await client.get(`/v1/projects/${projectUuid}/quotes`).withSession(other.session)
    ).assertStatus(404)
    ;(await client.get(path).withSession(vendor.session)).assertStatus(200)
    ;(await client.get(path).withSession(adminSession)).assertStatus(200)
    ;(await client.get(path).withSession(customer.session)).assertStatus(200)
  })

  test('the cleanup jobs leave manual projects alone', async ({ client, assert }) => {
    const { projectUuid } = await manualProjectWithFile(client)
    const project = await Project.findByOrFail('uuid', projectUuid)
    await Project.query()
      .where('id', project.id)
      .update({ updated_at: DateTime.now().minus({ days: 90 }).toSQL() })

    await new (ExpireAbandonedProjects as any)().execute()
    await project.refresh()
    assert.equal(project.status, 'draft')

    // Even one marked expired (by hand) keeps its files.
    project.merge({ status: 'expired', expiredAt: DateTime.now().minus({ days: 30 }) })
    await project.save()
    await new (PurgeExpiredProjects as any)().execute()
    assert.lengthOf(await ProjectFile.query().where('projectId', project.id), 1)
  })
})
