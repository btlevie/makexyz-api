import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import mail from '@adonisjs/mail/services/main'
import db from '@adonisjs/lucid/services/db'
import NewMessageNotification from '#mails/new_message_notification'
import ConversationParticipant from '#models/conversation_participant'
import Customer from '#models/customer'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import { openOrderThread } from '#services/conversation_service'
import { postSystemMessage } from '#services/message_service'
import { sendPendingNotification } from '#services/message_notification_service'
import {
  acceptedOrder,
  activeVendor,
  messagePayload,
  startInquiry,
  verifiedCustomer,
  dataOf,
  mailText,
} from '#tests/helpers/messaging'

test.group('Messaging: notifications', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    return async () => {
      mail.restore()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  async function vendorParticipant(conversationUuid: string) {
    return ConversationParticipant.query()
      .whereHas('conversation', (query) => query.where('uuid', conversationUuid))
      .where('role', 'vendor')
      .firstOrFail()
  }

  test('a burst of messages queues one delayed job per recipient', async ({ client, assert }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const started = await startInquiry(client, customer.session, vendor.vendor)
    const uuid = dataOf(started).conversation.uuid
    for (const body of ['Second thing', 'Third thing']) {
      await client
        .post(`/v1/conversations/${uuid}/messages`)
        .withSession(customer.session)
        .json(messagePayload(body))
    }

    const participant = await vendorParticipant(uuid)
    const jobs = await db
      .from('queue_jobs')
      .where('dedup_id', 'like', `%participant-${participant.id}`)
    assert.lengthOf(jobs, 1)
    assert.equal(jobs[0].status, 'delayed')
  })

  test('a burst of messages becomes one email, without the message text', async ({
    client,
    assert,
  }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const started = await startInquiry(client, customer.session, vendor.vendor)
    const uuid = dataOf(started).conversation.uuid
    await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(customer.session)
      .json(messagePayload('Also - is 0.1mm tolerance possible?'))
    const { mails } = mail.fake()

    const participant = await vendorParticipant(uuid)
    assert.isTrue(await sendPendingNotification(participant.id))
    assert.isFalse(await sendPendingNotification(participant.id))

    mails.assertSentCount(NewMessageNotification, 1)
    mails.assertSent(NewMessageNotification, (sent) => {
      sent.message.hasTo(vendor.user.email)
      return mailText(sent).includes('2 new messages') && !mailText(sent).includes('0.1mm')
    })
    await participant.refresh()
    assert.equal(participant.lastNotifiedSeq, 2)
  })

  test('nothing is emailed once the recipient has read the messages', async ({
    client,
    assert,
  }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const started = await startInquiry(client, customer.session, vendor.vendor)
    const uuid = dataOf(started).conversation.uuid
    await client.post(`/v1/conversations/${uuid}/read`).withSession(vendor.session).json({ seq: 1 })
    const { mails } = mail.fake()

    const participant = await vendorParticipant(uuid)
    assert.isFalse(await sendPendingNotification(participant.id))
    mails.assertNoneSent()
  })

  test('held and blocked messages never trigger an email', async ({ client, assert }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const started = await startInquiry(client, customer.session, vendor.vendor)
    const uuid = dataOf(started).conversation.uuid
    const participant = await vendorParticipant(uuid)
    await sendPendingNotification(participant.id)

    await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(customer.session)
      .json(messagePayload('call 415-555-2671'))
    await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(customer.session)
      .json(messagePayload('see https://x.example.net'))
    const { mails } = mail.fake()

    assert.isFalse(await sendPendingNotification(participant.id))
    mails.assertNoneSent()
  })

  test('an established sender gets their message text included', async ({ client }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    await MessagingRiskProfile.create({ customerId: customer.customer.id, trustTier: 'standard' })
    const started = await startInquiry(
      client,
      customer.session,
      vendor.vendor,
      'Twenty brackets in black PETG, please.'
    )
    const { mails } = mail.fake()

    const participant = await vendorParticipant(dataOf(started).conversation.uuid)
    await sendPendingNotification(participant.id)

    mails.assertSent(NewMessageNotification, (sent) =>
      mailText(sent).includes('Twenty brackets in black PETG')
    )
  })

  test('a guest customer is emailed at their guest address and told to sign in', async ({
    client,
    assert,
  }) => {
    const guest = await Customer.create({ uuid: string.uuid(), email: 'guest@example.com' })
    const vendor = await activeVendor(client)
    const order = await acceptedOrder(guest, vendor.vendor)
    const conversation = (await openOrderThread(order))!
    await postSystemMessage(conversation, 'Your order has been accepted.')
    const { mails } = mail.fake()

    const participant = await ConversationParticipant.query()
      .where('conversationId', conversation.id)
      .where('role', 'customer')
      .firstOrFail()
    assert.isTrue(await sendPendingNotification(participant.id))

    mails.assertSent(NewMessageNotification, (sent) => {
      sent.message.hasTo('guest@example.com')
      return mailText(sent).includes('Create or sign in')
    })
  })
})
