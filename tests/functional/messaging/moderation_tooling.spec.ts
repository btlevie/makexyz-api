import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import mail from '@adonisjs/mail/services/main'
import { DateTime } from 'luxon'
import ModerationDigestNotification from '#mails/moderation_digest_notification'
import ModerationWarningNotification from '#mails/moderation_warning_notification'
import Conversation from '#models/conversation'
import Message from '#models/message'
import ModerationAction from '#models/moderation_action'
import ModerationCase from '#models/moderation_case'
import { sendModerationDigest } from '#services/moderation_digest_service'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import { clearDomainListCache } from '#services/moderation/url/domain_registry'
import { resetUrlAnalysisFakes } from '#services/url_analysis_service'
import { signupAs } from '#tests/helpers/vendors'
import {
  activeVendor,
  analyzeWithoutReputation,
  dataOf,
  mailText,
  messagePayload,
  startInquiry,
  verifiedCustomer,
} from '#tests/helpers/messaging'

test.group('Messaging: moderator tooling', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    clearRuleConfigCache()
    clearDomainListCache()
    resetUrlAnalysisFakes()
    return async () => {
      mail.restore()
      clearRuleConfigCache()
      clearDomainListCache()
      resetUrlAnalysisFakes()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  async function inquiryBetween(client: any) {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client, 'Acme Print Works')
    const started = await startInquiry(client, customer.session, vendor.vendor)
    started.assertStatus(201)
    return { customer, vendor, uuid: dataOf(started).conversation.uuid as string }
  }

  async function send(client: any, session: any, uuid: string, body: string) {
    const response = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(session)
      .json(messagePayload(body))
    response.assertStatus(201)
    return dataOf(response)
  }

  /** A message held for a person, and its case. */
  async function heldCase(
    client: any,
    session: any,
    uuid: string,
    body = 'Samples at https://my-shop.example.net/s'
  ) {
    const sent = await send(client, session, uuid, body)
    await analyzeWithoutReputation(sent.uuid)
    const message = await Message.findByOrFail('uuid', sent.uuid)
    return ModerationCase.query().where('messageId', message.id).firstOrFail()
  }

  test('a claim keeps other moderators off a case until it lapses', async ({ client, assert }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    const first = await signupAs(client, 'admin')
    const second = await signupAs(client, 'admin')
    const moderationCase = await heldCase(client, vendor.session, uuid)
    const url = `/v1/admin/moderation/cases/${moderationCase.uuid}`

    const claim = await client.post(`${url}/claim`).withSession(first.session)
    claim.assertStatus(200)
    assert.equal(dataOf(claim).status, 'claimed')

    for (const action of ['approve', 'block', 'claim']) {
      const blocked = await client.post(`${url}/${action}`).withSession(second.session).json({})
      blocked.assertStatus(409)
    }
    const unassigned = await client
      .get('/v1/admin/moderation/cases?assigned=unassigned')
      .withSession(second.session)
    assert.lengthOf(dataOf(unassigned), 0)
    const mine = await client
      .get('/v1/admin/moderation/cases?assigned=mine')
      .withSession(first.session)
    assert.lengthOf(dataOf(mine), 1)

    // A lapsed claim can be taken over.
    await ModerationCase.query()
      .where('id', moderationCase.id)
      .update({ claimed_at: DateTime.now().minus({ minutes: 31 }).toSQL() })
    const takeover = await client.post(`${url}/claim`).withSession(second.session)
    takeover.assertStatus(200)
    const release = await client.post(`${url}/release`).withSession(second.session)
    assert.equal(dataOf(release).status, 'open')
  })

  test('the case detail has everything in one response', async ({ client, assert }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    await send(client, vendor.session, uuid, 'Email me at sales@acmeprint.com instead')
    const moderationCase = await heldCase(client, vendor.session, uuid)
    const message = await Message.findOrFail(moderationCase.messageId!)
    await ModerationCase.create({
      uuid: string.uuid(),
      vendorId: vendor.vendor.id,
      source: 'behavioral',
      priority: 25,
      status: 'resolved',
      resolution: 'no_action',
      missedByAutomation: false,
    })

    const response = await client
      .get(`/v1/admin/moderation/cases/${moderationCase.uuid}`)
      .withSession(admin.session)
    response.assertStatus(200)
    const detail = dataOf(response)

    assert.equal(detail.case.source, 'auto_hold')
    assert.equal(detail.message.uuid, message.uuid)
    assert.isTrue(
      detail.message.highlights.some((span: any) => span.match.includes('my-shop.example.net'))
    )
    assert.equal(detail.message.links[0].domain, 'my-shop.example.net')
    // The thread around it, the earlier blocked message included.
    assert.deepEqual(
      detail.thread.map((row: any) => row.status),
      ['delivered', 'blocked', 'pending_review']
    )
    assert.isTrue(detail.thread.at(-1).current)
    // Real identities - admins only.
    const emails = detail.conversation.participants.map((participant: any) => participant.email)
    assert.include(emails, customer.user.email)
    assert.include(emails, vendor.user.email)
    // Every pass, with rules, thresholds and the behavior snapshot.
    const sync = detail.evaluations[0]
    assert.equal(sync.stage, 'sync')
    assert.equal(sync.decision, 'hold')
    assert.deepEqual(sync.thresholds, { flag: 2, escalate: 4, review: 8 })
    assert.isAbove(sync.behavior.messagesLastDay, 0)
    assert.equal(detail.evaluations.at(-1).stage, 'async')
    assert.include(
      detail.evaluations.at(-1).hits.map((hit: any) => hit.ruleId),
      'url.reputation_unknown'
    )
    assert.lengthOf(detail.subject.pastCases, 1)
    assert.equal(detail.subject.blockedMessages30d, 1)
  })

  test('labels, warnings and closing are recorded', async ({ client, assert }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    const moderationCase = await heldCase(client, vendor.session, uuid)
    const url = `/v1/admin/moderation/cases/${moderationCase.uuid}`
    const { mails } = mail.fake()

    const label = await client.patch(`${url}/label`).withSession(admin.session).json({
      abuseCategory: 'advertising',
      patternNote: 'links own shop',
      missedByAutomation: false,
    })
    label.assertStatus(200)
    assert.equal(dataOf(label).abuseCategory, 'advertising')

    const warn = await client
      .post(`${url}/warn`)
      .withSession(admin.session)
      .json({ message: 'Please keep links to your own shop out of MakeXYZ messages.' })
    warn.assertStatus(200)
    mails.assertSent(ModerationWarningNotification, (sent) =>
      mailText(sent).includes('keep links to your own shop')
    )

    const close = await client.post(`${url}/close-conversation`).withSession(admin.session).json({})
    close.assertStatus(200)
    const conversation = await Conversation.findByOrFail('uuid', uuid)
    assert.equal(conversation.status, 'read_only')
    assert.equal(conversation.closedReason, 'staff')
    const notice = await Message.query()
      .where('conversationId', conversation.id)
      .where('kind', 'system')
      .firstOrFail()
    assert.equal(notice.body, 'MakeXYZ closed this conversation.')

    const actions = await ModerationAction.query().where('caseId', moderationCase.id).orderBy('id')
    assert.deepEqual(
      actions.map((action) => action.action),
      ['label_case', 'warn_user', 'close_conversation']
    )

    const tooShort = await client
      .post(`${url}/warn`)
      .withSession(admin.session)
      .json({ message: 'no' })
    tooShort.assertStatus(422)
  })

  test('spam a moderator blocked is blocked at once for anyone sending it', async ({
    client,
    assert,
  }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    const other = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    const pitch =
      'Huge summer sale on all prints, best prices guaranteed, order today for fast turnaround'
    const first = await send(client, vendor.session, uuid, pitch)
    const message = await Message.findByOrFail('uuid', first.uuid)
    const report = await ModerationCase.create({
      uuid: string.uuid(),
      messageId: message.id,
      vendorId: vendor.vendor.id,
      source: 'report',
      priority: 40,
      status: 'open',
      missedByAutomation: true,
    })
    const block = await client
      .post(`/v1/admin/moderation/cases/${report.uuid}/block`)
      .withSession(admin.session)
      .json({ abuseCategory: 'spam' })
    block.assertStatus(200)

    const repeat = await send(client, other.vendor.session, other.uuid, pitch)
    assert.equal(repeat.status, 'blocked')
    const blocked = await Message.findByOrFail('uuid', repeat.uuid)
    assert.equal(blocked.blockReasonCode, 'spam.known_blocked_text')
  })

  test('the queue filters by source, rule, sender and category', async ({ client, assert }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    await heldCase(client, vendor.session, uuid)
    await heldCase(client, customer.session, uuid, 'See https://customer-site.example.org/x')

    const list = async (query: string) =>
      dataOf(await client.get(`/v1/admin/moderation/cases?${query}`).withSession(admin.session))
    assert.lengthOf(await list('source=auto_hold'), 2)
    assert.lengthOf(await list('source=report'), 0)
    assert.lengthOf(await list('ruleId=url.reputation_unknown'), 2)
    assert.lengthOf(await list('senderRole=vendor'), 1)
    assert.lengthOf(await list(`vendorUuid=${vendor.vendor.uuid}`), 1)
    assert.lengthOf(await list('abuseCategory=spam'), 0)
  })

  test('admins get a digest only when someone is waiting', async ({ client, assert }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    const { mails } = mail.fake()
    assert.equal(await sendModerationDigest(), 0)

    await heldCase(client, vendor.session, uuid)
    assert.equal(await sendModerationDigest(), 1)
    mails.assertSent(ModerationDigestNotification, (sent) => {
      const recipients = JSON.stringify(sent.message.toJSON().message.to ?? [])
      return (
        recipients.includes(admin.user.email) &&
        mailText(sent).includes('1 message(s) are held for review')
      )
    })
  })
})
