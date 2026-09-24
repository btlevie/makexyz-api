import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import AuditEvent from '#models/audit_event'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Order from '#models/order'
import Payment from '#models/payment'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import Refund from '#models/refund'
import Shipment from '#models/shipment'
import User from '#models/user'
import Vendor from '#models/vendor'
import type VendorPayout from '#models/vendor_payout'
import { computePayoutBreakdown } from '#services/payout_calculation_service'
import { fakePayoutGateway, PayoutGatewayError } from '#services/payout_gateway_service'
import { fakePaypalIdentityClient } from '#services/paypal_identity_service'
import { FAKE_VALID_TRANSMISSION_SIG } from '#services/paypal_webhook_service'
import { applyTrackerUpdate } from '#services/shipment_tracking_service'
import { fakeStripeConnectClient } from '#services/stripe_connect_service'
import {
  completePaypalConnect,
  isPayoutMethodReady,
  refreshStripeStatus,
  startPaypalConnect,
} from '#services/vendor_payout_method_service'
import { createPayoutForAcceptedOrder, processDuePayouts } from '#services/vendor_payout_service'
import { createMaterial, makePayoutReady, setPayoutRate } from '#tests/helpers/payouts'

const paypalHeaders = {
  'paypal-transmission-id': 'test-transmission-id',
  'paypal-transmission-time': '2026-01-01T00:00:00Z',
  'paypal-transmission-sig': FAKE_VALID_TRANSMISSION_SIG,
  'paypal-cert-url': 'https://api.paypal.com/cert.pem',
  'paypal-auth-algo': 'SHA256withRSA',
}

async function createVendor(provider: 'stripe' | 'paypal' = 'stripe', payoutHoldDays?: number) {
  const user = await User.create({
    uuid: string.uuid(),
    email: `vendor-${string.uuid()}@test.com`,
    password: 'password123',
    role: 'vendor',
  })
  const vendor = await Vendor.create({
    uuid: string.uuid(),
    userId: user.id,
    payoutHoldDays: payoutHoldDays ?? null,
  })
  await makePayoutReady(vendor, provider)
  return vendor
}

/**
 * An order `vendor` accepted, with a captured payment and its pending payout
 * (70% of a $100 part + $10 production-time fee = $80). `status` is the
 * order's status; for 'delivered', eligibleAt is set as delivery would.
 */
async function createAcceptedOrder(
  vendor: Vendor,
  options: { status?: Order['status']; eligibleAt?: DateTime | null } = {}
) {
  const material = await createMaterial(`PLA ${string.random(4)}`)
  await setPayoutRate(vendor, material, '70.00')

  const customer = await Customer.create({ uuid: string.uuid() })
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer.id,
    status: 'ordered',
  })
  const quote = await Quote.create({
    uuid: string.uuid(),
    projectId: project.id,
    revision: 1,
    subtotal: '100.00',
    tax: '8.00',
    total: '118.00',
    status: 'accepted',
    generatedBy: 'system',
    destinationCountry: 'US',
    shippingMethod: 'free',
    shippingFeeAmount: '0.00',
    productionTimeBusinessDays: 3,
    productionTimeFeeAmount: '10.00',
  })
  const checkoutSession = await CheckoutSession.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    projectId: project.id,
    customerId: customer.id,
    status: 'completed',
    expiresAt: DateTime.now().plus({ hours: 120 }),
  })
  const payment = await Payment.create({
    checkoutSessionId: checkoutSession.id,
    provider: 'stripe',
    transactionId: `pi_${string.random(10)}`,
    amount: '118.00',
    status: 'captured',
    capturedAt: DateTime.now(),
    providerFee: '3.72',
    netAmount: '114.28',
  })
  const status = options.status ?? 'delivered'
  const order = await Order.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    customerId: customer.id,
    projectId: project.id,
    vendorId: vendor.id,
    orderNumber: `ORD-${string.generateRandom(6).toUpperCase()}`,
    subtotal: '100.00',
    tax: '8.00',
    total: '118.00',
    shippingMethod: 'free',
    shippingFeeAmount: '0.00',
    productionTimeFeeAmount: '10.00',
    status,
    deliveredAt: status === 'delivered' ? DateTime.now().minus({ days: 11 }) : null,
  })
  const projectFile = await ProjectFile.create({
    uuid: string.uuid(),
    projectId: project.id,
    fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
    originalName: 'part.stl',
    mimeType: 'model/stl',
    fileSize: 1024,
    status: 'completed',
    technology: 'fdm',
    materialId: material.id,
  })
  await order.related('items').create({
    projectFileId: projectFile.id,
    itemType: 'printing',
    description: 'part',
    quantity: 1,
    unitPrice: '100.00',
    total: '100.00',
  })

  const payout = await db.transaction(async (trx) => {
    const breakdown = await computePayoutBreakdown(order, vendor, trx)
    return createPayoutForAcceptedOrder(order, vendor, breakdown, trx)
  })
  const eligibleAt =
    options.eligibleAt !== undefined
      ? options.eligibleAt
      : status === 'delivered'
        ? DateTime.now().minus({ days: 1 })
        : null
  payout.eligibleAt = eligibleAt
  await payout.save()

  return { order, payment, payout }
}

async function signupAdmin(client: any) {
  const email = `admin-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Staff',
    lastName: 'Admin',
    email,
    password: 'password123',
  })
  const user = await User.findByOrFail('email', email)
  user.role = 'admin'
  await user.save()
  return response.session()
}

function paypalItemEvent(payout: VendorPayout, status: string, errorName?: string) {
  return {
    id: `WH-${string.random(12)}`,
    event_type: `PAYMENT.PAYOUTS-ITEM.${status}`,
    resource: {
      payout_item_id: `ITEM${string.random(8).toUpperCase()}`,
      transaction_status: status,
      payout_item: { sender_item_id: payout.providerIdempotencyKey },
      ...(errorName ? { errors: { name: errorName, message: errorName } } : {}),
    },
  }
}

test.group('Payouts | processing', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(() => {
    fakePayoutGateway.reset()
    fakeStripeConnectClient.reset()
    fakePaypalIdentityClient.reset()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('delivery starts the hold: 10 days by default, or the vendor override', async ({
    assert,
  }) => {
    for (const [holdDays, expectedDays] of [
      [undefined, 10],
      [3, 3],
    ] as const) {
      const vendor = await createVendor('stripe', holdDays)
      const { order, payout } = await createAcceptedOrder(vendor, { status: 'ready_to_ship' })
      const shipment = await Shipment.create({
        uuid: string.uuid(),
        orderId: order.id,
        vendorId: vendor.id,
        status: 'label_created',
        weightOz: '12.00',
        lengthIn: '8.00',
        widthIn: '6.00',
        heightIn: '4.00',
      })

      const deliveredAt = DateTime.fromISO('2026-09-20T15:00:00Z')
      await db.transaction((trx) => applyTrackerUpdate(shipment.id, 'delivered', deliveredAt, trx))

      await payout.refresh()
      assert.equal(
        payout.eligibleAt?.toUTC().toISO(),
        deliveredAt.plus({ days: expectedDays }).toUTC().toISO()
      )
    }
  })

  test('nothing is sent before the hold ends', async ({ assert }) => {
    const vendor = await createVendor()
    const { payout } = await createAcceptedOrder(vendor, {
      eligibleAt: DateTime.now().plus({ days: 2 }),
    })

    await processDuePayouts()

    await payout.refresh()
    assert.equal(payout.status, 'pending')
    assert.equal(fakePayoutGateway.sendCount, 0)
  })

  test('a Stripe vendor is paid by transfer to their connected account', async ({ assert }) => {
    const vendor = await createVendor('stripe')
    const { payout } = await createAcceptedOrder(vendor)

    await processDuePayouts()

    await payout.refresh()
    assert.equal(payout.status, 'paid')
    assert.isNotNull(payout.paidAt)
    assert.match(payout.providerTransactionId!, /^tr_fake_/)

    const sent = fakePayoutGateway.sends.get(payout.uuid)!
    assert.equal(sent.destination, vendor.stripeAccountId)
    assert.equal(sent.amount, '80.00')
  })

  test('a PayPal vendor is paid to their verified payer id, finished by webhook', async ({
    client,
    assert,
  }) => {
    const vendor = await createVendor('paypal')
    const { payout } = await createAcceptedOrder(vendor)

    await processDuePayouts()
    await payout.refresh()
    assert.equal(payout.status, 'processing')
    assert.equal(fakePayoutGateway.sends.get(payout.uuid)!.destination, vendor.paypalPayerId)

    const response = await client
      .post('/v1/webhooks/paypal')
      .headers(paypalHeaders)
      .json(paypalItemEvent(payout, 'SUCCEEDED'))
    response.assertStatus(200)

    await payout.refresh()
    assert.equal(payout.status, 'paid')
    assert.match(payout.providerTransactionId!, /^ITEM/)
  })

  test('running the job twice never sends twice', async ({ assert }) => {
    const vendor = await createVendor()
    await createAcceptedOrder(vendor)

    await processDuePayouts()
    await processDuePayouts()

    assert.equal(fakePayoutGateway.sendCount, 1)
  })

  test('an interrupted send is recovered later without paying twice', async ({ assert }) => {
    const vendor = await createVendor()
    const { payout } = await createAcceptedOrder(vendor)
    fakePayoutGateway.failNextAfterSend = true

    await processDuePayouts()
    await payout.refresh()
    assert.equal(payout.status, 'processing')

    await processDuePayouts(DateTime.now().plus({ minutes: 20 }))
    await payout.refresh()
    assert.equal(payout.status, 'paid')
    assert.equal(fakePayoutGateway.sendCount, 1)
  })

  test('a partial refund holds the payout; an admin can release it at a reduced amount', async ({
    client,
    assert,
  }) => {
    const vendor = await createVendor()
    const { payout, payment } = await createAcceptedOrder(vendor)
    await Refund.create({
      paymentId: payment.id,
      amount: '20.00',
      provider: 'stripe',
      providerRefundId: 're_partial',
      status: 'succeeded',
    })

    await processDuePayouts()
    await payout.refresh()
    assert.equal(payout.status, 'held')
    assert.equal(payout.holdReason, 'partial_refund')
    assert.equal(fakePayoutGateway.sendCount, 0)

    const adminSession = await signupAdmin(client)
    const held = await client.get('/v1/admin/payouts?status=held').withSession(adminSession)
    held.assertStatus(200)
    assert.lengthOf(held.body().data as unknown[], 1)

    const release = await client
      .post(`/v1/admin/payouts/${payout.uuid}/release`)
      .withSession(adminSession)
      .json({ amount: 65.5 })
    release.assertStatus(200)
    const released = release.body().data as Record<string, any>
    assert.equal(released.status, 'pending')
    assert.equal(released.amount, '65.50')
    assert.equal(released.breakdown.adjustment.previousAmount, '80.00')

    await processDuePayouts()
    await payout.refresh()
    assert.equal(payout.status, 'paid')
    assert.equal(fakePayoutGateway.sends.get(payout.uuid)!.amount, '65.50')
  })

  test('an open dispute holds the payout; a closed one does not', async ({ assert }) => {
    const vendor = await createVendor()
    const { payout, payment } = await createAcceptedOrder(vendor)
    const { payout: closedPayout, payment: closedPayment } = await createAcceptedOrder(vendor)

    const dispute = (paymentId: number, reason: string) =>
      AuditEvent.create({
        entityType: 'payment',
        entityId: paymentId,
        eventType: 'updated',
        userId: null,
        payload: { reason, providerDisputeId: `dp_${paymentId}` },
      })
    await dispute(payment.id, 'dispute_created')
    await dispute(closedPayment.id, 'dispute_created')
    await dispute(closedPayment.id, 'dispute_closed')

    await processDuePayouts()

    await payout.refresh()
    assert.equal(payout.status, 'held')
    assert.equal(payout.holdReason, 'open_dispute')
    await closedPayout.refresh()
    assert.equal(closedPayout.status, 'paid')
  })

  test('a full refund cancels the payout, even before delivery', async ({ assert }) => {
    const vendor = await createVendor()
    const { payout } = await createAcceptedOrder(vendor, { status: 'refunded' })

    await processDuePayouts()

    await payout.refresh()
    assert.equal(payout.status, 'cancelled')
    assert.isNotNull(payout.cancelledAt)
    assert.equal(fakePayoutGateway.sendCount, 0)
  })

  test('a platform failure fails the payout without touching the vendor; admin retry pays it', async ({
    client,
    assert,
  }) => {
    const vendor = await createVendor()
    const { payout } = await createAcceptedOrder(vendor)
    fakePayoutGateway.nextError = new PayoutGatewayError(
      'Insufficient platform balance',
      'platform'
    )

    await processDuePayouts()
    await payout.refresh()
    assert.equal(payout.status, 'failed')
    assert.equal(payout.failureKind, 'platform')
    await vendor.refresh()
    assert.isNull(vendor.payoutMethodError)
    assert.isTrue(isPayoutMethodReady(vendor))

    const adminSession = await signupAdmin(client)
    const retry = await client
      .post(`/v1/admin/payouts/${payout.uuid}/retry`)
      .withSession(adminSession)
    retry.assertStatus(200)

    await processDuePayouts()
    await payout.refresh()
    assert.equal(payout.status, 'paid')
  })

  test('an unclaimed PayPal payout is pulled back, flags the vendor, and is re-sent after they reconnect', async ({
    client,
    assert,
  }) => {
    const vendor = await createVendor('paypal')
    const { payout } = await createAcceptedOrder(vendor)
    const { payout: laterPayout } = await createAcceptedOrder(vendor, {
      eligibleAt: DateTime.now().plus({ hours: 1 }),
    })

    await processDuePayouts()
    const unclaimed = paypalItemEvent(payout, 'UNCLAIMED')
    const unclaimedResponse = await client
      .post('/v1/webhooks/paypal')
      .headers(paypalHeaders)
      .json(unclaimed)
    unclaimedResponse.assertStatus(200)

    await payout.refresh()
    assert.equal(payout.status, 'failed')
    assert.equal(payout.failureKind, 'recipient')
    assert.deepEqual(fakePayoutGateway.cancelledPaypalItems, [unclaimed.resource.payout_item_id])

    await vendor.refresh()
    assert.isNotNull(vendor.payoutMethodError)
    assert.isFalse(isPayoutMethodReady(vendor))

    // The vendor's next payout comes due while their account is broken - held, not sent.
    await processDuePayouts(DateTime.now().plus({ hours: 2 }))
    await laterPayout.refresh()
    assert.equal(laterPayout.status, 'held')
    assert.equal(laterPayout.holdReason, 'payout_method_invalid')

    // Reconnecting a working PayPal account re-queues both, due now.
    fakePaypalIdentityClient.nextIdentity = {
      payerId: 'NEWPAYER2',
      email: 'fixed@paypal.test',
      verifiedAccount: true,
    }
    const state = new URL(startPaypalConnect(vendor)).searchParams.get('state')!
    await completePaypalConnect(vendor, 'fake-code', state)

    await payout.refresh()
    await laterPayout.refresh()
    assert.equal(payout.status, 'pending')
    assert.equal(laterPayout.status, 'pending')

    // The failed payout is re-sent under a new idempotency key (a used
    // PayPal sender_batch_id can't be reused), both to the new payer id.
    assert.equal(payout.sendAttempt, 2)
    await processDuePayouts(DateTime.now().plus({ hours: 2 }))
    await payout.refresh()
    assert.equal(payout.status, 'processing')
    assert.equal(fakePayoutGateway.sends.get(`${payout.uuid}-2`)!.destination, 'NEWPAYER2')
    assert.equal(fakePayoutGateway.sends.get(laterPayout.uuid)!.destination, 'NEWPAYER2')

    // A late event about the first attempt doesn't disturb the second.
    const stale = paypalItemEvent(payout, 'SUCCEEDED')
    stale.resource.payout_item.sender_item_id = payout.uuid
    const staleResponse = await client
      .post('/v1/webhooks/paypal')
      .headers(paypalHeaders)
      .json(stale)
    staleResponse.assertStatus(200)
    await payout.refresh()
    assert.equal(payout.status, 'processing')
  })

  test('a Stripe account that can no longer receive payouts is a recipient failure, recovered on refresh', async ({
    assert,
  }) => {
    const vendor = await createVendor('stripe')
    const { payout } = await createAcceptedOrder(vendor)
    fakeStripeConnectClient.setPayoutsEnabled(vendor.stripeAccountId!, false)

    await processDuePayouts()
    await payout.refresh()
    assert.equal(payout.status, 'failed')
    assert.equal(payout.failureKind, 'recipient')
    await vendor.refresh()
    assert.isNotNull(vendor.payoutMethodError)

    fakeStripeConnectClient.setPayoutsEnabled(vendor.stripeAccountId!, true)
    await refreshStripeStatus(vendor)
    assert.isNull(vendor.payoutMethodError)
    await payout.refresh()
    assert.equal(payout.status, 'pending')

    await processDuePayouts()
    await payout.refresh()
    assert.equal(payout.status, 'paid')
  })

  test('vendors see their own payouts; payout admin endpoints need an admin', async ({
    client,
    assert,
  }) => {
    const email = `vendor-${string.uuid()}@test.com`
    const signup = await client.post('/v1/auth/new-customer').json({
      firstName: 'Vendor',
      lastName: 'User',
      email,
      password: 'password123',
    })
    const user = await User.findByOrFail('email', email)
    user.role = 'vendor'
    await user.save()
    const vendor = await Vendor.create({ uuid: string.uuid(), userId: user.id })
    await makePayoutReady(vendor)
    const { order, payout } = await createAcceptedOrder(vendor)
    const other = await createVendor()
    await createAcceptedOrder(other)

    const mine = await client.get('/v1/vendor/payouts').withSession(signup.session())
    mine.assertStatus(200)
    const rows = mine.body().data as Record<string, any>[]
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].uuid, payout.uuid)
    assert.equal(rows[0].orderUuid, order.uuid)
    assert.equal(rows[0].amount, '80.00')

    const forbidden = await client.get('/v1/admin/payouts').withSession(signup.session())
    forbidden.assertStatus(403)
  })

  test('admins manage payout rates and hold periods', async ({ client, assert }) => {
    const vendor = await createVendor()
    const pla = await createMaterial('PLA')
    const adminSession = await signupAdmin(client)

    const rates = await client
      .put(`/v1/admin/vendors/${vendor.uuid}/payout-rates`)
      .withSession(adminSession)
      .json({ rates: [{ materialUuid: pla.uuid, percentage: 72.5 }] })
    rates.assertStatus(200)
    const saved = rates.body().data as Record<string, any>[]
    assert.equal(saved.find((rate) => rate.materialUuid === pla.uuid)!.percentage, '72.50')

    const unknown = await client
      .put(`/v1/admin/vendors/${vendor.uuid}/payout-rates`)
      .withSession(adminSession)
      .json({ rates: [{ materialUuid: string.uuid(), percentage: 50 }] })
    unknown.assertStatus(422)

    const hold = await client
      .patch(`/v1/admin/vendors/${vendor.uuid}`)
      .withSession(adminSession)
      .json({ payoutHoldDays: 5 })
    hold.assertStatus(200)
    await vendor.refresh()
    assert.equal(vendor.payoutHoldDays, 5)
  })
})
