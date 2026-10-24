import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'
import Customer from '#models/customer'
import Message from '#models/message'
import MessageReport from '#models/message_report'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import ModerationAction from '#models/moderation_action'
import ModerationCase from '#models/moderation_case'
import {
  detectReportRateOutliers,
  detectSharedDomainClusters,
  sampleAuditMessages,
} from '#services/behavior_pattern_service'
import { behaviorLookups } from '#services/behavior_signal_service'
import { effectiveTrustTier, refreshRiskProfile } from '#services/messaging_risk_service'
import { buildViews } from '#services/moderation/normalizer'
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

test.group('Messaging: behavioral detection', (group) => {
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
    const vendor = await activeVendor(client)
    const started = await startInquiry(client, customer.session, vendor.vendor)
    started.assertStatus(201)
    const conversation = await Conversation.findByOrFail('uuid', dataOf(started).conversation.uuid)
    return { customer, vendor, conversation }
  }

  async function send(client: any, session: any, uuid: string, body: string) {
    const response = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(session)
      .json(messagePayload(body))
    response.assertStatus(201)
    return dataOf(response)
  }

  /** Writes `count` messages straight into a conversation's history, as if sent at `at`. */
  async function seedMessages(
    conversation: Conversation,
    role: 'customer' | 'vendor',
    count: number,
    fields: Partial<Message> = {},
    at = DateTime.now().minus({ days: 1 })
  ) {
    const participant = await ConversationParticipant.query()
      .where('conversationId', conversation.id)
      .where('role', role)
      .firstOrFail()
    await conversation.refresh()
    for (let i = 0; i < count; i++) {
      conversation.lastSeq += 1
      await Message.create({
        uuid: string.uuid(),
        conversationId: conversation.id,
        senderParticipantId: participant.id,
        senderCustomerId: participant.customerId,
        senderVendorId: participant.vendorId,
        seq: conversation.lastSeq,
        kind: 'text',
        channel: 'web',
        body: `Seeded message ${i}`,
        status: 'delivered',
        deliveredAt: at,
        createdAt: at,
        ...fields,
      })
    }
    await conversation.save()
  }

  async function backdateCustomer(customer: Customer, days: number) {
    customer.createdAt = DateTime.now().minus({ days })
    await customer.save()
  }

  test('tiers are promoted from account age and clean history', async ({ client, assert }) => {
    const { customer, conversation } = await inquiryBetween(client)
    const principal = { customerId: customer.customer.id }
    assert.equal(await effectiveTrustTier(principal), 'new')

    await backdateCustomer(customer.customer, 10)
    await seedMessages(conversation, 'customer', 5)
    await refreshRiskProfile(principal)
    assert.equal(await effectiveTrustTier(principal), 'standard')

    await backdateCustomer(customer.customer, 90)
    await seedMessages(conversation, 'customer', 50)
    const profile = await refreshRiskProfile(principal)
    assert.equal(profile!.trustTier, 'trusted')
    assert.equal(profile!.deliveredMessages, 56)

    // One report in 30 days is enough to lose "trusted".
    const vendorParticipant = await ConversationParticipant.query()
      .where('conversationId', conversation.id)
      .where('role', 'vendor')
      .firstOrFail()
    const reported = await Message.query()
      .where('senderCustomerId', customer.customer.id)
      .firstOrFail()
    await MessageReport.create({
      uuid: string.uuid(),
      messageId: reported.id,
      reporterParticipantId: vendorParticipant.id,
      reason: 'spam_ad',
    })
    assert.equal((await refreshRiskProfile(principal))!.trustTier, 'standard')
  })

  test('two upheld blocks in 30 days restrict automatically; lifting sticks', async ({
    client,
    assert,
  }) => {
    const { customer, conversation } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    const principal = { customerId: customer.customer.id }
    await backdateCustomer(customer.customer, 30)
    await seedMessages(conversation, 'customer', 10)

    // Automatic blocks never count...
    await seedMessages(conversation, 'customer', 3, {
      status: 'blocked',
      blockReasonCode: 'contact.email',
    })
    assert.equal((await refreshRiskProfile(principal))!.trustTier, 'standard')

    // ...a moderator upholding them does.
    await seedMessages(conversation, 'customer', 2, {
      status: 'removed',
      blockReasonCode: 'moderator',
    })
    const restricted = await refreshRiskProfile(principal)
    assert.equal(restricted!.trustTier, 'restricted')
    assert.equal(restricted!.tierSource, 'auto')
    assert.isTrue(restricted!.restrictionExpiresAt! > DateTime.now().plus({ days: 29 }))
    const action = await ModerationAction.findByOrFail('action', 'restrict_user')
    assert.isNull(action.actorUserId)
    assert.equal(action.targetId, customer.customer.uuid)

    const held = await send(
      client,
      customer.session,
      conversation.uuid,
      'Can we do 30 units instead?'
    )
    assert.equal(held.status, 'pending_review')

    const heldMessage = await Message.findByOrFail('uuid', held.uuid)
    const moderationCase = await ModerationCase.query()
      .where('messageId', heldMessage.id)
      .firstOrFail()
    const lift = await client
      .post(`/v1/admin/moderation/cases/${moderationCase.uuid}/restrict`)
      .withSession(admin.session)
      .json({ tier: 'standard', note: 'reviewed, fine' })
    lift.assertStatus(200)
    assert.equal((await refreshRiskProfile(principal))!.trustTier, 'standard')
  })

  test('more than 3 blocks in an hour holds the sender and opens a case', async ({
    client,
    assert,
  }) => {
    const { customer, conversation } = await inquiryBetween(client)
    for (const address of ['a@gmail.com', 'b@gmail.com', 'c@gmail.com', 'd@gmail.com']) {
      const sent = await send(client, customer.session, conversation.uuid, `email me at ${address}`)
      assert.equal(sent.status, 'blocked')
    }

    const profile = await MessagingRiskProfile.findByOrFail('customerId', customer.customer.id)
    assert.isTrue(profile.holdUntil! > DateTime.now().plus({ hours: 23 }))
    assert.equal(profile.holdReason, 'repeated_blocks')
    const moderationCase = await ModerationCase.query().where('source', 'behavioral').firstOrFail()
    assert.lengthOf(moderationCase.details!.blockedMessages as unknown[], 4)

    const next = await send(
      client,
      customer.session,
      conversation.uuid,
      'Sorry - can you quote 10 units?'
    )
    assert.equal(next.status, 'pending_review')
    // The hold expires on its own - no suspension.
    profile.holdUntil = DateTime.now().minus({ minutes: 1 })
    await profile.save()
    assert.notEqual(await effectiveTrustTier({ customerId: customer.customer.id }), 'restricted')
  })

  test('blocks by two vendors hold the customer', async ({ client, assert }) => {
    const customer = await verifiedCustomer(client)
    for (const name of ['Acme Print', 'Beta Fab']) {
      const vendor = await activeVendor(client, name)
      const started = await startInquiry(client, customer.session, vendor.vendor)
      const block = await client
        .post(`/v1/vendor/conversations/${dataOf(started).conversation.uuid}/block-customer`)
        .withSession(vendor.session)
        .json({ reason: 'abusive' })
      block.assertStatus(204)
    }
    const profile = await MessagingRiskProfile.findByOrFail('customerId', customer.customer.id)
    assert.equal(profile.vendorBlocks, 2)
    assert.equal(profile.holdReason, 'vendor_blocks')
    await ModerationCase.query()
      .where('source', 'behavioral')
      .where('dedupKey', `hold:vendor_blocks:customer:${customer.customer.id}`)
      .firstOrFail()
  })

  test('send-time lookups: volume, near-duplicates and shared domains', async ({
    client,
    assert,
  }) => {
    const { conversation } = await inquiryBetween(client)
    const second = await inquiryBetween(client)
    const pitch =
      'We are a full service print farm with forty machines and same day shipping, twenty percent off your first order'
    await seedMessages(
      second.conversation,
      'vendor',
      1,
      { body: pitch },
      DateTime.now().minus({ hours: 2 })
    )
    await seedMessages(conversation, 'customer', 3, {}, DateTime.now().minus({ minutes: 10 }))

    // That vendor sending a lightly edited pitch in another conversation.
    const pitchingVendor = await ConversationParticipant.query()
      .where('conversationId', second.conversation.id)
      .where('role', 'vendor')
      .firstOrFail()
    const lookups = await behaviorLookups(pitchingVendor, conversation.id, {
      contentHash: 'x',
      normalized: buildViews(pitch.replace('forty', 'fifty')).normalized,
      domains: [],
    })
    assert.equal(lookups.nearDuplicateOtherConversations, 1)

    const customerParticipant = await ConversationParticipant.query()
      .where('conversationId', conversation.id)
      .where('role', 'customer')
      .firstOrFail()
    const own = await behaviorLookups(customerParticipant, conversation.id, {
      contentHash: 'x',
      normalized: 'hi',
      domains: [],
    })
    // The opener plus three seeded in the last hour.
    assert.equal(own.messagesLastHour, 4)
    assert.equal(own.conversationsLastDay, 1)
    assert.equal(own.vendorsContactedWeek, 1)

    await send(
      client,
      second.customer.session,
      second.conversation.uuid,
      'see https://deals.example.shop/x'
    )
    const spread = await behaviorLookups(customerParticipant, conversation.id, {
      contentHash: 'x',
      normalized: 'hi',
      domains: ['example.shop'],
    })
    assert.deepEqual(spread.domainSenders, { 'example.shop': 1 })
  })

  test("a burst far beyond the sender's baseline opens a case", async ({ client, assert }) => {
    const { customer, conversation } = await inquiryBetween(client)
    await seedMessages(conversation, 'customer', 25, {}, DateTime.now())
    await refreshRiskProfile({ customerId: customer.customer.id })
    const moderationCase = await ModerationCase.query().where('source', 'behavioral').firstOrFail()
    assert.equal(moderationCase.details!.kind, 'volume_anomaly')
    assert.isAtLeast(moderationCase.details!.currentHour as number, 25)

    // Refreshing again in the same hour doesn't open a second case.
    await refreshRiskProfile({ customerId: customer.customer.id })
    assert.lengthOf(await ModerationCase.query().where('source', 'behavioral'), 1)
  })

  test('new accounts converging on one unlisted domain form a cluster case', async ({
    client,
    assert,
  }) => {
    const vendor = await activeVendor(client)
    for (let i = 0; i < 3; i++) {
      const customer = await verifiedCustomer(client)
      await startInquiry(
        client,
        customer.session,
        vendor.vendor,
        `Pricing for my parts is listed at https://quote-${i}.cheap-parts.shop/list`
      )
    }
    assert.equal(await detectSharedDomainClusters(), 1)
    const cluster = await ModerationCase.query()
      .where('dedupKey', 'cluster:domain:cheap-parts.shop')
      .firstOrFail()
    assert.lengthOf(cluster.details!.accounts as unknown[], 3)
    assert.equal(await detectSharedDomainClusters(), 0)

    // Established accounts don't make a cluster.
    await Customer.query().update({ created_at: DateTime.now().minus({ days: 30 }).toSQL() })
    await cluster.merge({ status: 'resolved' }).save()
    assert.equal(await detectSharedDomainClusters(), 0)
  })

  test('a vendor reported far more than peers opens a case', async ({ client, assert }) => {
    const { conversation } = await inquiryBetween(client)
    await seedMessages(conversation, 'vendor', 4)
    const customerParticipant = await ConversationParticipant.query()
      .where('conversationId', conversation.id)
      .where('role', 'customer')
      .firstOrFail()
    const messages = await Message.query().whereNotNull('senderVendorId').limit(3)
    for (const message of messages) {
      await MessageReport.create({
        uuid: string.uuid(),
        messageId: message.id,
        reporterParticipantId: customerParticipant.id,
        reason: 'harassment',
      })
    }
    assert.equal(await detectReportRateOutliers(), 1)
    const outlier = await ModerationCase.query().where('source', 'behavioral').firstOrFail()
    assert.equal(outlier.details!.kind, 'report_rate_outlier')
    assert.equal(outlier.details!.reports, 3)
  })

  test('the audit sample takes unflagged delivered messages only', async ({ client, assert }) => {
    const { conversation } = await inquiryBetween(client)
    await seedMessages(conversation, 'vendor', 5, {}, DateTime.now().minus({ hours: 2 }))
    const sampled = await sampleAuditMessages()
    assert.equal(sampled, 1)
    const audit = await ModerationCase.findByOrFail('source', 'audit_sample')
    assert.isNotNull(audit.messageId)
  })

  test('admins can list held and restricted senders', async ({ client, assert }) => {
    const { customer } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    await MessagingRiskProfile.create({
      customerId: customer.customer.id,
      trustTier: 'new',
      holdUntil: DateTime.now().plus({ hours: 5 }),
      holdReason: 'repeated_blocks',
    })
    const held = await client
      .get('/v1/admin/moderation/profiles?held=true')
      .withSession(admin.session)
    held.assertStatus(200)
    assert.deepInclude(dataOf(held)[0], {
      subject: { type: 'customer', uuid: customer.customer.uuid },
      holdReason: 'repeated_blocks',
    })
    const forbidden = await client
      .get('/v1/admin/moderation/profiles')
      .withSession(customer.session)
    forbidden.assertStatus(403)
  })
})
