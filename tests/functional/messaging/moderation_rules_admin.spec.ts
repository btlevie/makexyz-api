import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import Conversation from '#models/conversation'
import MessageReport from '#models/message_report'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import ModerationAction from '#models/moderation_action'
import ModerationCase from '#models/moderation_case'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import { signupAs } from '#tests/helpers/vendors'
import {
  activeVendor,
  dataOf,
  messagePayload,
  startInquiry,
  verifiedCustomer,
} from '#tests/helpers/messaging'

test.group('Messaging: deterministic rules, reports and rule admin', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    clearRuleConfigCache()
    return async () => {
      clearRuleConfigCache()
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

  async function send(client: any, session: any, uuid: string, body: string) {
    const response = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(session)
      .json(messagePayload(body))
    response.assertStatus(201)
    return dataOf(response)
  }

  test('a prohibited item is blocked with the policy reason and opens a case', async ({
    client,
    assert,
  }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)

    const started = await startInquiry(
      client,
      customer.session,
      vendor.vendor,
      'Can you print 10 glock switches?'
    )

    const message = dataOf(started).message
    assert.equal(message.status, 'blocked')
    assert.include(message.reason, 'Prohibited items policy')
    const moderationCase = await ModerationCase.query()
      .where('source', 'prohibited_item')
      .firstOrFail()
    assert.equal(moderationCase.customerId, customer.customer.id)
  })

  test('crypto and bank details are blocked at launch', async ({ client, assert }) => {
    const { vendor, uuid } = await inquiryBetween(client)

    const crypto = await send(
      client,
      vendor.session,
      uuid,
      'BTC 1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
    )
    const iban = await send(client, vendor.session, uuid, 'IBAN GB82 WEST 1234 5698 7654 32')

    assert.equal(crypto.status, 'blocked')
    assert.equal(iban.status, 'blocked')
    assert.include(crypto.reason, 'payment details')
  })

  test('shadow rules record hits without affecting delivery', async ({ client, assert }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')

    const sent = await send(
      client,
      vendor.session,
      uuid,
      'If you pay me directly on Venmo it is cheaper'
    )

    assert.equal(sent.status, 'delivered')
    const view = await client.get(`/v1/admin/conversations/${uuid}`).withSession(admin.session)
    const hits = dataOf(view).messages.at(-1).ruleHits
    assert.deepInclude(
      hits.find((hit: any) => hit.ruleId === 'payment.direct_intent'),
      {
        shadow: true,
      }
    )
  })

  test('admins see every rule and can promote one from shadow to enforce', async ({
    client,
    assert,
  }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')

    const list = await client.get('/v1/admin/moderation/rules').withSession(admin.session)
    list.assertStatus(200)
    const rule = dataOf(list).find((row: any) => row.id === 'payment.direct_intent')
    assert.equal(rule.mode, 'shadow')

    const promote = await client
      .patch('/v1/admin/moderation/rules/payment.direct_intent')
      .withSession(admin.session)
      .json({ mode: 'enforce', reason: 'precise in shadow for 3 weeks' })
    promote.assertStatus(200)
    assert.equal(dataOf(promote).mode, 'enforce')
    assert.equal(dataOf(promote).configVersion, 1)

    const sent = await send(
      client,
      vendor.session,
      uuid,
      'If you pay me directly on Venmo it is cheaper'
    )
    assert.equal(sent.status, 'pending_review')

    const action = await ModerationAction.query()
      .where('action', 'rule_config_change')
      .firstOrFail()
    assert.equal(action.targetId, 'payment.direct_intent')
    assert.equal(action.reason, 'precise in shadow for 3 weeks')
  })

  test('rule config overrides are validated against the rule', async ({ client }) => {
    const admin = await signupAs(client, 'admin')

    const unknownKey = await client
      .patch('/v1/admin/moderation/rules/ad.promo_language')
      .withSession(admin.session)
      .json({ config: { nonsense: 1 } })
    unknownKey.assertStatus(422)

    const wrongType = await client
      .patch('/v1/admin/moderation/rules/ad.promo_language')
      .withSession(admin.session)
      .json({ config: { weight: 'heavy' } })
    wrongType.assertStatus(422)

    const unknownRule = await client
      .patch('/v1/admin/moderation/rules/no.such_rule')
      .withSession(admin.session)
      .json({ mode: 'off' })
    unknownRule.assertStatus(404)
  })

  test('only admins can see or change rules', async ({ client }) => {
    const customer = await verifiedCustomer(client)
    const list = await client.get('/v1/admin/moderation/rules').withSession(customer.session)
    list.assertStatus(403)
    const change = await client
      .patch('/v1/admin/moderation/rules/contact.email')
      .withSession(customer.session)
      .json({ mode: 'off' })
    change.assertStatus(403)
  })

  test('a blocking rule with no user message gives a generic reason', async ({
    client,
    assert,
  }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    await client
      .patch('/v1/admin/moderation/rules/ad.unrelated_url')
      .withSession(admin.session)
      .json({ mode: 'enforce' })

    const sent = await send(
      client,
      vendor.session,
      uuid,
      'Visit our store at prints4less.example.shop for 30% off'
    )

    assert.equal(sent.status, 'blocked')
    assert.equal(sent.reason, "This message couldn't be delivered.")
  })

  test('the duplicate-spam rule sees the same text sent across conversations', async ({
    client,
    assert,
  }) => {
    const admin = await signupAs(client, 'admin')
    await client
      .patch('/v1/admin/moderation/rules/spam.duplicate_cross_conversation')
      .withSession(admin.session)
      .json({ mode: 'enforce' })
    const vendor = await activeVendor(client)
    const pitch = 'Best 3D printing prices anywhere, ask me how!'

    const statuses: string[] = []
    for (let i = 0; i < 3; i++) {
      const customer = await verifiedCustomer(client)
      // Each customer writes their own opener - identical text from several
      // senders is itself what the rule catches.
      const started = await startInquiry(
        client,
        customer.session,
        vendor.vendor,
        `Hi, I need ${i + 2} PETG brackets printed`
      )
      const sent = await send(client, vendor.session, dataOf(started).conversation.uuid, pitch)
      statuses.push(sent.status)
    }

    assert.deepEqual(statuses, ['delivered', 'delivered', 'pending_review'])
  })

  test('reporting a message opens one case per message, shared across reports', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const sent = await send(client, vendor.session, uuid, 'Lets talk somewhere else')

    const report = await client
      .post(`/v1/conversations/${uuid}/messages/${sent.uuid}/report`)
      .withSession(customer.session)
      .json({ reason: 'contact_sharing', note: 'asked to move off MakeXYZ' })
    report.assertStatus(201)
    const again = await client
      .post(`/v1/conversations/${uuid}/messages/${sent.uuid}/report`)
      .withSession(customer.session)
      .json({ reason: 'scam' })
    again.assertStatus(200)

    const reports = await MessageReport.all()
    assert.lengthOf(reports, 1)
    const moderationCase = await ModerationCase.findOrFail(reports[0].caseId)
    assert.equal(moderationCase.source, 'report')
    assert.isTrue(moderationCase.missedByAutomation)
    assert.equal(moderationCase.vendorId, vendor.vendor.id)
  })

  test("you can't report your own message", async ({ client }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    const sent = await send(client, vendor.session, uuid, 'Hello there')

    const report = await client
      .post(`/v1/conversations/${uuid}/messages/${sent.uuid}/report`)
      .withSession(vendor.session)
      .json({ reason: 'other' })
    report.assertStatus(422)
  })

  test('restricting a case subject sends their later messages to review', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    const sent = await send(client, vendor.session, uuid, 'Hi')
    await client
      .post(`/v1/conversations/${uuid}/messages/${sent.uuid}/report`)
      .withSession(customer.session)
      .json({ reason: 'harassment' })
    const moderationCase = await ModerationCase.firstOrFail()

    const restrict = await client
      .post(`/v1/admin/moderation/cases/${moderationCase.uuid}/restrict`)
      .withSession(admin.session)
      .json({ tier: 'restricted', days: 7, note: 'repeated rudeness' })
    restrict.assertStatus(200)
    assert.equal(dataOf(restrict).trustTier, 'restricted')

    const profile = await MessagingRiskProfile.findByOrFail('vendorId', vendor.vendor.id)
    assert.isNotNull(profile.restrictionExpiresAt)
    const later = await send(client, vendor.session, uuid, 'Your parts are ready')
    assert.equal(later.status, 'pending_review')

    const action = await ModerationAction.query().where('action', 'restrict_user').firstOrFail()
    assert.equal(action.targetId, vendor.vendor.uuid)
  })

  test('a vendor declining an inquiry as prohibited alerts staff', async ({ client, assert }) => {
    const { vendor, uuid, customer } = await inquiryBetween(client)

    const decline = await client
      .post(`/v1/vendor/conversations/${uuid}/decline`)
      .withSession(vendor.session)
      .json({ reasonCode: 'prohibited_item', reason: 'This is a firearm part' })
    decline.assertStatus(204)

    const moderationCase = await ModerationCase.query()
      .where('source', 'prohibited_item')
      .firstOrFail()
    assert.equal(moderationCase.customerId, customer.customer.id)
    const conversation = await Conversation.findByOrFail('uuid', uuid)
    assert.equal(conversation.closedReason, 'declined')
  })
})
