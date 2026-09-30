import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import Conversation from '#models/conversation'
import Customer from '#models/customer'
import Message from '#models/message'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import { closeExpiredConversations, openOrderThread } from '#services/conversation_service'
import {
  acceptedOrder,
  activeVendor,
  messagePayload,
  startInquiry,
  verifiedCustomer,
  dataOf,
} from '#tests/helpers/messaging'

test.group('Messaging: conversations', (group) => {
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

  async function inquiryBetween(client: any) {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const started = await startInquiry(client, customer.session, vendor.vendor)
    started.assertStatus(201)
    return { customer, vendor, uuid: dataOf(started).conversation.uuid as string }
  }

  test('non-participants get a 404, and signed-out callers a 401', async ({ client }) => {
    const { uuid } = await inquiryBetween(client)
    const stranger = await verifiedCustomer(client)

    const asStranger = await client.get(`/v1/conversations/${uuid}`).withSession(stranger.session)
    asStranger.assertStatus(404)
    const messages = await client
      .get(`/v1/conversations/${uuid}/messages`)
      .withSession(stranger.session)
    messages.assertStatus(404)
    const post = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(stranger.session)
      .json(messagePayload('hi'))
    post.assertStatus(404)

    const signedOut = await client.get(`/v1/conversations/${uuid}`)
    signedOut.assertStatus(401)
  })

  test('a retried send with the same clientMessageId returns the original', async ({
    client,
    assert,
  }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const payload = messagePayload('Can you do black PETG?')

    const first = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(customer.session)
      .json(payload)
    const retry = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(customer.session)
      .json(payload)

    first.assertStatus(201)
    retry.assertStatus(200)
    assert.equal(dataOf(retry).uuid, dataOf(first).uuid)
    const conversation = await Conversation.findByOrFail('uuid', uuid)
    const stored = await Message.query().where('conversationId', conversation.id)
    assert.lengthOf(stored, 2)
  })

  test('concurrent sends get distinct, gap-free sequence numbers', async ({ client, assert }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        client
          .post(`/v1/conversations/${uuid}/messages`)
          .withSession(i % 2 === 0 ? customer.session : vendor.session)
          .json(messagePayload(`message ${i}`))
      )
    )

    for (const response of responses) response.assertStatus(201)
    const seqs = responses.map((response) => dataOf(response).seq).sort((a, b) => a - b)
    assert.deepEqual(seqs, [2, 3, 4, 5, 6, 7])
    const conversation = await Conversation.findByOrFail('uuid', uuid)
    assert.equal(conversation.lastSeq, 7)
  })

  test("the recipient never sees the sender's blocked or held messages", async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)

    const blocked = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
      .json(messagePayload('Just call me on 415-555-2671 and skip the fees'))
    const held = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
      .json(messagePayload('Samples are on my-print-shop.example.net'))
    blocked.assertStatus(201)
    held.assertStatus(201)
    assert.equal(dataOf(blocked).status, 'blocked')
    assert.match(dataOf(blocked).reason, /phone numbers/)
    assert.equal(dataOf(held).status, 'pending_review')

    const customerView = await client
      .get(`/v1/conversations/${uuid}/messages`)
      .withSession(customer.session)
    assert.deepEqual(
      dataOf(customerView).map((message: any) => message.seq),
      [1]
    )

    const vendorView = await client
      .get(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
    assert.deepEqual(
      dataOf(vendorView).map((message: any) => [message.seq, message.status]),
      [
        [1, 'delivered'],
        [2, 'blocked'],
        [3, 'pending_review'],
      ]
    )
  })

  test('marking read clears the unread count and never moves backwards', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
      .json(messagePayload('Yes, we can do that.'))

    let shown = await client.get(`/v1/conversations/${uuid}`).withSession(customer.session)
    assert.equal(dataOf(shown).unreadCount, 1)

    const read = await client
      .post(`/v1/conversations/${uuid}/read`)
      .withSession(customer.session)
      .json({ seq: 2 })
    read.assertStatus(204)
    await client
      .post(`/v1/conversations/${uuid}/read`)
      .withSession(customer.session)
      .json({ seq: 1 })

    shown = await client.get(`/v1/conversations/${uuid}`).withSession(customer.session)
    assert.equal(dataOf(shown).unreadCount, 0)
    assert.equal(dataOf(shown).lastReadSeq, 2)
  })

  test('an order thread keeps the vendor white-label and follows the order', async ({
    client,
    assert,
  }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client, 'Secret Vendor LLC')
    const order = await acceptedOrder(customer.customer, vendor.vendor)
    const conversation = (await openOrderThread(order))!

    const shown = await client
      .get(`/v1/conversations/${conversation.uuid}`)
      .withSession(customer.session)
    shown.assertStatus(200)
    const names = dataOf(shown).participants.map((participant: any) => participant.displayName)
    assert.include(names, 'Your manufacturer')
    assert.notInclude(JSON.stringify(shown.body()), 'Secret Vendor')

    const sent = await client
      .post(`/v1/conversations/${conversation.uuid}/messages`)
      .withSession(vendor.session)
      .json(messagePayload('Your parts start printing tomorrow.'))
    sent.assertStatus(201)

    // Refunded - the thread stops taking messages right away, and the sweep
    // marks it read-only.
    order.status = 'refunded'
    await order.save()
    const late = await client
      .post(`/v1/conversations/${conversation.uuid}/messages`)
      .withSession(customer.session)
      .json(messagePayload('Thanks!'))
    late.assertStatus(409)
    await closeExpiredConversations()
    await conversation.refresh()
    assert.equal(conversation.closedReason, 'order_closed')
  })

  test('reassigning an order cuts off the previous vendor', async ({ client }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const replacement = await activeVendor(client, 'Replacement')
    const order = await acceptedOrder(customer.customer, vendor.vendor)
    const conversation = (await openOrderThread(order))!

    order.vendorId = replacement.vendor.id
    await order.save()

    const response = await client
      .get(`/v1/conversations/${conversation.uuid}`)
      .withSession(vendor.session)
    response.assertStatus(404)
  })

  test('an order thread stays open for 14 days after delivery', async ({ client, assert }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const order = await acceptedOrder(customer.customer, vendor.vendor, 'delivered')
    order.deliveredAt = DateTime.now().minus({ days: 3 })
    await order.save()
    const conversation = (await openOrderThread(order))!

    const recent = await client
      .post(`/v1/conversations/${conversation.uuid}/messages`)
      .withSession(customer.session)
      .json(messagePayload('One part arrived cracked.'))
    recent.assertStatus(201)

    order.deliveredAt = DateTime.now().minus({ days: 15 })
    await order.save()
    const late = await client
      .post(`/v1/conversations/${conversation.uuid}/messages`)
      .withSession(customer.session)
      .json(messagePayload('Another thing...'))
    late.assertStatus(409)
    assert.equal(await closeExpiredConversations(), 1)
  })

  test("a guest customer's order thread needs an account to read", async ({ client }) => {
    const guest = await Customer.create({ uuid: string.uuid(), email: 'guest@example.com' })
    const vendor = await activeVendor(client)
    const order = await acceptedOrder(guest, vendor.vendor)
    const conversation = (await openOrderThread(order))!

    const signedOut = await client.get(`/v1/conversations/${conversation.uuid}`)
    signedOut.assertStatus(401)
  })

  test("a restricted sender's messages all wait for review", async ({ client, assert }) => {
    const { customer, uuid } = await inquiryBetween(client)
    await MessagingRiskProfile.create({
      customerId: customer.customer.id,
      trustTier: 'restricted',
    })

    const response = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(customer.session)
      .json(messagePayload('Perfectly normal question about infill.'))

    response.assertStatus(201)
    assert.equal(dataOf(response).status, 'pending_review')
  })

  test('a suspended sender can still message a live order, but everything is reviewed', async ({
    client,
    assert,
  }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    await MessagingRiskProfile.create({ vendorId: vendor.vendor.id, trustTier: 'suspended' })
    const order = await acceptedOrder(customer.customer, vendor.vendor)
    const conversation = (await openOrderThread(order))!

    const orderMessage = await client
      .post(`/v1/conversations/${conversation.uuid}/messages`)
      .withSession(vendor.session)
      .json(messagePayload('Shipping Monday.'))
    orderMessage.assertStatus(201)
    assert.equal(dataOf(orderMessage).status, 'pending_review')

    const other = await verifiedCustomer(client)
    const inquiry = await startInquiry(client, other.session, vendor.vendor)
    const inquiryReply = await client
      .post(`/v1/conversations/${dataOf(inquiry).conversation.uuid}/messages`)
      .withSession(vendor.session)
      .json(messagePayload('Hello!'))
    inquiryReply.assertStatus(403)
  })
})
