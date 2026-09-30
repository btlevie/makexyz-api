import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import Conversation from '#models/conversation'
import ModerationCase from '#models/moderation_case'
import ModerationRuleConfig from '#models/moderation_rule_config'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import { signupAs } from '#tests/helpers/vendors'
import {
  activeVendor,
  messagePayload,
  startInquiry,
  verifiedCustomer,
  dataOf,
} from '#tests/helpers/messaging'

test.group('Messaging: moderation queue', (group) => {
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

  test('a held opener waits in the queue; approving it shows the inquiry to the vendor', async ({
    client,
    assert,
  }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const admin = await signupAs(client, 'admin')

    const started = await startInquiry(
      client,
      customer.session,
      vendor.vendor,
      'Drawings are at https://drawings.example.net/part-7'
    )
    assert.equal(dataOf(started).message.status, 'pending_review')
    const uuid = dataOf(started).conversation.uuid
    const hidden = await client.get(`/v1/conversations/${uuid}`).withSession(vendor.session)
    hidden.assertStatus(404)

    const queue = await client.get('/v1/admin/moderation/cases').withSession(admin.session)
    queue.assertStatus(200)
    const [item] = dataOf(queue)
    assert.equal(item.source, 'auto_hold')
    assert.equal(item.conversationUuid, uuid)
    assert.equal(item.message.ruleHits[0].ruleId, 'url.any_non_allowlisted_holds')

    const approve = await client
      .post(`/v1/admin/moderation/cases/${item.uuid}/approve`)
      .withSession(admin.session)
      .json({})
    approve.assertStatus(200)
    assert.equal(dataOf(approve).resolution, 'approved')

    const visible = await client
      .get(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
    visible.assertStatus(200)
    assert.equal(dataOf(visible)[0].seq, 1)
    assert.equal(dataOf(visible)[0].status, 'delivered')
  })

  test('blocking a held message tells the sender why', async ({ client, assert }) => {
    const { session, customer } = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const admin = await signupAs(client, 'admin')
    const started = await startInquiry(client, session, vendor.vendor)
    const uuid = dataOf(started).conversation.uuid
    const held = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
      .json(messagePayload('Order direct at cheap-prints.example.org'))
    void customer

    const moderationCase = await ModerationCase.query().where('source', 'auto_hold').firstOrFail()
    const block = await client
      .post(`/v1/admin/moderation/cases/${moderationCase.uuid}/block`)
      .withSession(admin.session)
      .json({ note: 'advertising' })
    block.assertStatus(200)
    assert.equal(dataOf(block).resolution, 'blocked')

    const senderView = await client
      .get(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
    const blocked = dataOf(senderView).find((m: any) => m.uuid === dataOf(held).uuid)
    assert.equal(blocked.status, 'blocked')
    assert.isString(blocked.reason)
  })

  test('removing a delivered message leaves a tombstone for the recipient', async ({
    client,
    assert,
  }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const admin = await signupAs(client, 'admin')
    const started = await startInquiry(client, customer.session, vendor.vendor)
    const uuid = dataOf(started).conversation.uuid
    const conversation = await Conversation.findByOrFail('uuid', uuid)

    const firstMessage = await conversation.related('messages').query().firstOrFail()
    const moderationCase = await ModerationCase.create({
      uuid: crypto.randomUUID(),
      messageId: firstMessage.id,
      customerId: customer.customer.id,
      source: 'report',
      priority: 50,
      status: 'open',
      missedByAutomation: true,
    })

    const block = await client
      .post(`/v1/admin/moderation/cases/${moderationCase.uuid}/block`)
      .withSession(admin.session)
      .json({})
    block.assertStatus(200)
    assert.equal(dataOf(block).resolution, 'removed')

    const vendorView = await client
      .get(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
    assert.deepInclude(dataOf(vendorView)[0], { removed: true, body: null, status: 'removed' })
  })

  test('a resolved case cannot be resolved again', async ({ client }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const admin = await signupAs(client, 'admin')
    await startInquiry(client, customer.session, vendor.vendor, 'See https://x.example.net')
    const moderationCase = await ModerationCase.firstOrFail()

    await client
      .post(`/v1/admin/moderation/cases/${moderationCase.uuid}/approve`)
      .withSession(admin.session)
      .json({})
    const again = await client
      .post(`/v1/admin/moderation/cases/${moderationCase.uuid}/block`)
      .withSession(admin.session)
      .json({})
    again.assertStatus(409)
  })

  test('only admins reach the queue and the admin conversation view', async ({ client }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const started = await startInquiry(client, customer.session, vendor.vendor)
    const uuid = dataOf(started).conversation.uuid

    for (const session of [customer.session, vendor.session]) {
      const queue = await client.get('/v1/admin/moderation/cases').withSession(session)
      queue.assertStatus(403)
      const view = await client.get(`/v1/admin/conversations/${uuid}`).withSession(session)
      view.assertStatus(403)
    }
  })

  test('admins see every message with the rules that fired', async ({ client, assert }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const admin = await signupAs(client, 'admin')
    const started = await startInquiry(client, customer.session, vendor.vendor, 'jo@gmail.com')
    const uuid = dataOf(started).conversation.uuid

    const view = await client.get(`/v1/admin/conversations/${uuid}`).withSession(admin.session)

    view.assertStatus(200)
    const [message] = dataOf(view).messages
    assert.equal(message.status, 'blocked')
    assert.equal(message.blockReasonCode, 'contact.email')
    assert.equal(message.ruleHits[0].ruleId, 'contact.email')
  })

  test('a rule switched to shadow mode records its hit without blocking', async ({
    client,
    assert,
  }) => {
    await ModerationRuleConfig.create({ ruleId: 'contact.email', mode: 'shadow', configVersion: 2 })
    clearRuleConfigCache()
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const admin = await signupAs(client, 'admin')

    const started = await startInquiry(client, customer.session, vendor.vendor, 'jo@gmail.com')
    assert.equal(dataOf(started).message.status, 'delivered')

    const view = await client
      .get(`/v1/admin/conversations/${dataOf(started).conversation.uuid}`)
      .withSession(admin.session)
    assert.deepInclude(dataOf(view).messages[0].ruleHits[0], {
      ruleId: 'contact.email',
      shadow: true,
    })
  })
})
