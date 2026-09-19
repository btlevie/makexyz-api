import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Address from '#models/address'
import AuditEvent from '#models/audit_event'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Order from '#models/order'
import Payment from '#models/payment'
import Project from '#models/project'
import Quote from '#models/quote'
import Refund from '#models/refund'
import { FAKE_VALID_TRANSMISSION_SIG } from '#services/paypal_webhook_service'

const validHeaders = {
  'paypal-transmission-id': 'test-transmission-id',
  'paypal-transmission-time': new Date().toISOString(),
  'paypal-transmission-sig': FAKE_VALID_TRANSMISSION_SIG,
  'paypal-cert-url': 'https://api.paypal.com/cert.pem',
  'paypal-auth-algo': 'SHA256withRSA',
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
    provider: 'paypal',
    transactionId: 'CAPTURE123',
    amount,
    status: 'captured',
    capturedAt: DateTime.now(),
    providerFee: '3.20',
    netAmount: (Number(amount) - 3.2).toFixed(2),
  })

  return { customer, project, quote, checkoutSession, order, payment }
}

test.group('Webhooks | PayPal', (group) => {
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

  test('a full PAYMENT.CAPTURE.REFUNDED event marks the payment and order refunded', async ({
    client,
    assert,
  }) => {
    const { order, payment } = await createCapturedPayment('100.00')

    const payload = {
      id: 'WH-REFUND-1',
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: {
        id: 'REFUND123',
        amount: { value: '100.00', currency_code: 'USD' },
        links: [{ rel: 'up', href: `https://api.paypal.com/v2/payments/captures/${payment.transactionId}` }],
      },
    }

    const response = await client.post('/v1/webhooks/paypal').headers(validHeaders).json(payload)

    response.assertStatus(200)

    await payment.refresh()
    assert.equal(payment.status, 'refunded')

    await order.refresh()
    assert.equal(order.status, 'refunded')

    const refund = await Refund.query().where('paymentId', payment.id).firstOrFail()
    assert.equal(refund.provider, 'paypal')
    assert.equal(refund.providerRefundId, 'REFUND123')
    assert.equal(refund.amount, '100.00')
  })

  test('a partial refund leaves the order alone', async ({ client, assert }) => {
    const { order, payment } = await createCapturedPayment('100.00')

    const payload = {
      id: 'WH-REFUND-2',
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: {
        id: 'REFUND124',
        amount: { value: '25.00', currency_code: 'USD' },
        links: [{ rel: 'up', href: `https://api.paypal.com/v2/payments/captures/${payment.transactionId}` }],
      },
    }

    const response = await client.post('/v1/webhooks/paypal').headers(validHeaders).json(payload)

    response.assertStatus(200)
    await order.refresh()
    assert.equal(order.status, 'accepted')
  })

  test('a dispute event records an audit event without changing payment/order status', async ({
    client,
    assert,
  }) => {
    const { order, payment } = await createCapturedPayment('100.00')

    const payload = {
      id: 'WH-DISPUTE-1',
      event_type: 'CUSTOMER.DISPUTE.CREATED',
      resource: {
        dispute_id: 'PP-D-123',
        reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
        status: 'OPEN',
        disputed_transactions: [
          { seller_transaction_id: payment.transactionId, gross_amount: { value: '100.00' } },
        ],
      },
    }

    const response = await client.post('/v1/webhooks/paypal').headers(validHeaders).json(payload)

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
    assert.equal(auditEvent.payload.providerDisputeId, 'PP-D-123')
  })

  test('an invalid signature is refused', async ({ client }) => {
    const response = await client
      .post('/v1/webhooks/paypal')
      .headers({ ...validHeaders, 'paypal-transmission-sig': 'not-the-fake-signature' })
      .json({ id: 'WH-BAD', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: {} })

    response.assertStatus(400)
  })

  test('the same event id delivered twice only applies once', async ({ client, assert }) => {
    const { payment } = await createCapturedPayment('100.00')

    const payload = {
      id: 'WH-DUPLICATE',
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: {
        id: 'REFUND125',
        amount: { value: '100.00', currency_code: 'USD' },
        links: [{ rel: 'up', href: `https://api.paypal.com/v2/payments/captures/${payment.transactionId}` }],
      },
    }

    const first = await client.post('/v1/webhooks/paypal').headers(validHeaders).json(payload)
    const second = await client.post('/v1/webhooks/paypal').headers(validHeaders).json(payload)

    first.assertStatus(200)
    second.assertStatus(200)

    const refunds = await Refund.query().where('paymentId', payment.id)
    assert.lengthOf(refunds, 1)
  })
})
