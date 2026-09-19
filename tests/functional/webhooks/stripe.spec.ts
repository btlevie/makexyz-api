import string from '@adonisjs/core/helpers/string'
import Stripe from 'stripe'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import env from '#start/env'
import Address from '#models/address'
import AuditEvent from '#models/audit_event'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Order from '#models/order'
import Payment from '#models/payment'
import Project from '#models/project'
import Quote from '#models/quote'
import Refund from '#models/refund'

const webhookSecret = env.get('STRIPE_WEBHOOK_SECRET')!
const stripe = new Stripe(env.get('STRIPE_SECRET_KEY')!)

function sign(payload: string) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret })
}

async function createCapturedPayment(amount = '100.00') {
  const customer = await Customer.create({ uuid: string.uuid() })
  const project = await Project.create({ uuid: string.uuid(), customerId: customer.id, status: 'draft' })
  const address = await Address.create({
    uuid: string.uuid(),
    ownerType: 'customer',
    customerId: customer.id,
    recipientName: 'Jane Doe',
    line1: '123 Main St',
    city: 'Springfield',
    postalCode: '62704',
    country: 'US',
  })
  const quote = await Quote.create({
    uuid: string.uuid(),
    projectId: project.id,
    revision: 1,
    subtotal: amount,
    tax: '0.00',
    total: amount,
    status: 'accepted',
    generatedBy: 'system',
    destinationCountry: 'US',
    shippingMethod: 'free',
    shippingFeeAmount: '0.00',
    productionTimeBusinessDays: 5,
    productionTimeFeeAmount: '0.00',
    addressId: address.id,
  })
  const checkoutSession = await CheckoutSession.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    projectId: project.id,
    customerId: customer.id,
    status: 'active',
    expiresAt: DateTime.now().plus({ hours: 1 }),
  })
  const order = await Order.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    customerId: customer.id,
    projectId: project.id,
    orderNumber: `ORD-${string.generateRandom(10).toUpperCase()}`,
    subtotal: amount,
    tax: '0.00',
    total: amount,
    status: 'accepted',
    addressId: address.id,
  })
  const payment = await Payment.create({
    checkoutSessionId: checkoutSession.id,
    provider: 'stripe',
    transactionId: 'pi_test_123',
    amount,
    status: 'captured',
    capturedAt: DateTime.now(),
    providerFee: '2.90',
    netAmount: (Number(amount) - 2.9).toFixed(2),
  })

  return { customer, project, quote, checkoutSession, order, payment }
}

test.group('Webhooks | Stripe', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(() => {
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('a full charge.refunded event marks the payment and order refunded', async ({
    client,
    assert,
  }) => {
    const { order, payment } = await createCapturedPayment('100.00')

    const payload = JSON.stringify({
      id: 'evt_refund_full',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_123',
          payment_intent: payment.transactionId,
          amount_refunded: 10000,
          refunds: { data: [{ id: 're_123', reason: 'requested_by_customer' }] },
        },
      },
    })

    const response = await client
      .post('/v1/webhooks/stripe')
      .header('stripe-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)

    await payment.refresh()
    assert.equal(payment.status, 'refunded')
    assert.isNotNull(payment.refundedAt)

    await order.refresh()
    assert.equal(order.status, 'refunded')

    const refund = await Refund.query().where('paymentId', payment.id).firstOrFail()
    assert.equal(refund.provider, 'stripe')
    assert.equal(refund.providerRefundId, 're_123')
    assert.equal(refund.amount, '100.00')
  })

  test('a partial charge.refunded event refunds the payment but leaves the order alone', async ({
    client,
    assert,
  }) => {
    const { order, payment } = await createCapturedPayment('100.00')

    const payload = JSON.stringify({
      id: 'evt_refund_partial',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_124',
          payment_intent: payment.transactionId,
          amount_refunded: 2500,
          refunds: { data: [{ id: 're_124', reason: 'requested_by_customer' }] },
        },
      },
    })

    const response = await client
      .post('/v1/webhooks/stripe')
      .header('stripe-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)

    await payment.refresh()
    assert.equal(payment.status, 'refunded')

    await order.refresh()
    assert.equal(order.status, 'accepted')

    const refund = await Refund.query().where('paymentId', payment.id).firstOrFail()
    assert.equal(refund.amount, '25.00')
  })

  test('a dispute event records an audit event without changing payment/order status', async ({
    client,
    assert,
  }) => {
    const { order, payment } = await createCapturedPayment('100.00')

    const payload = JSON.stringify({
      id: 'evt_dispute_created',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_123',
          payment_intent: payment.transactionId,
          amount: 10000,
          reason: 'fraudulent',
          status: 'needs_response',
        },
      },
    })

    const response = await client
      .post('/v1/webhooks/stripe')
      .header('stripe-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)

    await payment.refresh()
    assert.equal(payment.status, 'captured')
    await order.refresh()
    assert.equal(order.status, 'accepted')

    const auditEvent = await AuditEvent.query()
      .where('entityType', 'payment')
      .where('entityId', payment.id)
      .firstOrFail()
    assert.equal(auditEvent.eventType, 'updated')
    assert.equal(auditEvent.payload.reason, 'dispute_created')
    assert.equal(auditEvent.payload.providerDisputeId, 'dp_123')
  })

  test('an invalid signature is refused', async ({ client }) => {
    const payload = JSON.stringify({ id: 'evt_bad', type: 'charge.refunded', data: { object: {} } })

    const response = await client
      .post('/v1/webhooks/stripe')
      .header('stripe-signature', 'not-a-real-signature')
      .json(payload)

    response.assertStatus(400)
  })

  test('the same event id delivered twice only applies once', async ({ client, assert }) => {
    const { payment } = await createCapturedPayment('100.00')

    const payload = JSON.stringify({
      id: 'evt_duplicate',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_125',
          payment_intent: payment.transactionId,
          amount_refunded: 10000,
          refunds: { data: [{ id: 're_125', reason: 'requested_by_customer' }] },
        },
      },
    })
    const signature = sign(payload)

    const first = await client.post('/v1/webhooks/stripe').header('stripe-signature', signature).json(payload)
    const second = await client.post('/v1/webhooks/stripe').header('stripe-signature', signature).json(payload)

    first.assertStatus(200)
    second.assertStatus(200)

    const refunds = await Refund.query().where('paymentId', payment.id)
    assert.lengthOf(refunds, 1)
  })
})
