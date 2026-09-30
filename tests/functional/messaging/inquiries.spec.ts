import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import Conversation from '#models/conversation'
import ConversationBlock from '#models/conversation_block'
import Message from '#models/message'
import ModerationCase from '#models/moderation_case'
import { INQUIRY_DAILY_CAP_NEW_ACCOUNT } from '#services/conversation_service'
import { signupAs } from '#tests/helpers/vendors'
import {
  activeVendor,
  messagePayload,
  startInquiry,
  verifiedCustomer,
  dataOf,
} from '#tests/helpers/messaging'

test.group('Messaging: inquiries', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    return async () => {
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('a verified customer starts an inquiry the vendor then sees', async ({ client, assert }) => {
    const { session } = await verifiedCustomer(client)
    const { session: vendorSession, vendor } = await activeVendor(client)

    const response = await startInquiry(client, session, vendor)

    response.assertStatus(201)
    const { conversation, message } = dataOf(response)
    assert.equal(conversation.kind, 'inquiry')
    assert.equal(message.status, 'delivered')
    assert.equal(message.seq, 1)
    assert.deepEqual(
      conversation.participants.map((participant: any) => participant.displayName).sort(),
      // signupAs names the customer "customer User" - shown as first name + last initial.
      ['Acme Print', 'customer U.']
    )

    const listed = await client.get('/v1/conversations').withSession(vendorSession)
    listed.assertStatus(200)
    assert.lengthOf(dataOf(listed), 1)
    assert.equal(dataOf(listed)[0].unreadCount, 1)
  })

  test('an unverified customer cannot start an inquiry', async ({ client }) => {
    const { session } = await signupAs(client, 'customer')
    const { vendor } = await activeVendor(client)

    const response = await startInquiry(client, session, vendor)

    response.assertStatus(403)
    response.assertBodyContains({ code: 'email_unverified' })
  })

  test('vendors cannot start conversations with customers', async ({ client }) => {
    const { session } = await activeVendor(client, 'Vendor One')
    const { vendor: other } = await activeVendor(client, 'Vendor Two')

    const response = await startInquiry(client, session, other)

    response.assertStatus(403)
    response.assertBodyContains({ code: 'not_a_customer' })
  })

  test('an inactive vendor does not take inquiries', async ({ client }) => {
    const { session } = await verifiedCustomer(client)
    const { vendor } = await activeVendor(client)
    vendor.status = 'onboarding'
    await vendor.save()

    const response = await startInquiry(client, session, vendor)

    response.assertStatus(422)
    response.assertBodyContains({ code: 'vendor_unavailable' })
  })

  test('only one open inquiry per customer and vendor', async ({ client, assert }) => {
    const { session } = await verifiedCustomer(client)
    const { vendor } = await activeVendor(client)
    const first = await startInquiry(client, session, vendor)

    const second = await startInquiry(client, session, vendor, 'Another question')

    second.assertStatus(409)
    assert.equal((second.body() as any).conversationUuid, dataOf(first).conversation.uuid)
  })

  test('new accounts are capped on new inquiries per day', async ({ client }) => {
    const { session } = await verifiedCustomer(client)
    for (let i = 0; i < INQUIRY_DAILY_CAP_NEW_ACCOUNT; i++) {
      const { vendor } = await activeVendor(client, `Vendor ${i}`)
      const response = await startInquiry(client, session, vendor)
      response.assertStatus(201)
    }

    const { vendor } = await activeVendor(client, 'One too many')
    const response = await startInquiry(client, session, vendor)

    response.assertStatus(429)
    response.assertBodyContains({ code: 'daily_cap_reached' })
  })

  test('a blocked opener is kept for the customer but the vendor never sees the inquiry', async ({
    client,
    assert,
  }) => {
    const { session } = await verifiedCustomer(client)
    const { session: vendorSession, vendor } = await activeVendor(client)

    const response = await startInquiry(client, session, vendor, 'Email me at jo@gmail.com')

    response.assertStatus(201)
    const { conversation, message } = dataOf(response)
    assert.equal(message.status, 'blocked')
    assert.match(message.reason, /email addresses/)

    const listed = await client.get('/v1/conversations').withSession(vendorSession)
    assert.lengthOf(dataOf(listed), 0)
    const direct = await client
      .get(`/v1/conversations/${conversation.uuid}`)
      .withSession(vendorSession)
    direct.assertStatus(404)
  })

  test('declining closes the inquiry with a message to the customer', async ({
    client,
    assert,
  }) => {
    const { session } = await verifiedCustomer(client)
    const { session: vendorSession, vendor } = await activeVendor(client)
    const started = await startInquiry(client, session, vendor)
    const uuid = dataOf(started).conversation.uuid

    const decline = await client
      .post(`/v1/vendor/conversations/${uuid}/decline`)
      .withSession(vendorSession)
      .json({ reason: 'We only do SLA' })
    decline.assertStatus(204)

    const conversation = await Conversation.findByOrFail('uuid', uuid)
    assert.equal(conversation.status, 'read_only')
    assert.equal(conversation.closedReason, 'declined')
    assert.isNotNull(conversation.firstVendorResponseAt)

    const messages = await client.get(`/v1/conversations/${uuid}/messages`).withSession(session)
    const last = dataOf(messages).at(-1)
    assert.equal(last.kind, 'system')
    assert.include(last.body, 'We only do SLA')

    const reply = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(session)
      .json(messagePayload('Are you sure?'))
    reply.assertStatus(409)
  })

  test('blocking a customer stops further inquiries and alerts staff', async ({
    client,
    assert,
  }) => {
    const { session, customer } = await verifiedCustomer(client)
    const { session: vendorSession, vendor } = await activeVendor(client)
    const started = await startInquiry(client, session, vendor)
    const uuid = dataOf(started).conversation.uuid

    const block = await client
      .post(`/v1/vendor/conversations/${uuid}/block-customer`)
      .withSession(vendorSession)
      .json({ reason: 'Keeps asking to pay by Venmo' })
    block.assertStatus(204)

    const blockRow = await ConversationBlock.query()
      .where('vendorId', vendor.id)
      .where('customerId', customer.id)
      .firstOrFail()
    const moderationCase = await ModerationCase.findOrFail(blockRow.caseId)
    assert.equal(moderationCase.source, 'report')

    // Worded like any unavailable vendor - the customer isn't told.
    const again = await startInquiry(client, session, vendor, 'Hello again')
    again.assertStatus(422)
    again.assertBodyContains({ code: 'vendor_unavailable' })
  })

  test('an idle inquiry closes, and the customer can reopen it by posting', async ({
    client,
    assert,
  }) => {
    const { closeExpiredConversations } = await import('#services/conversation_service')
    const { session } = await verifiedCustomer(client)
    const { vendor } = await activeVendor(client)
    const started = await startInquiry(client, session, vendor)
    const uuid = dataOf(started).conversation.uuid

    await Conversation.query()
      .where('uuid', uuid)
      .update({ last_message_at: DateTime.now().minus({ days: 61 }).toSQL() })
    assert.equal(await closeExpiredConversations(), 1)
    let conversation = await Conversation.findByOrFail('uuid', uuid)
    assert.equal(conversation.closedReason, 'idle')

    const reply = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(session)
      .json(messagePayload('Still interested - any update?'))

    reply.assertStatus(201)
    conversation = await Conversation.findByOrFail('uuid', uuid)
    assert.equal(conversation.status, 'open')
    const messages = await Message.query().where('conversationId', conversation.id)
    assert.lengthOf(messages, 2)
  })
})
