import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Order from '#models/order'
import OrderRoutingConfig from '#models/order_routing_config'
import OrderStatusHistory from '#models/order_status_history'
import Payment from '#models/payment'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import User from '#models/user'
import Vendor from '#models/vendor'
import { fakePaymentGateway } from '#services/payment_gateway_service'
import { fakeTaxCalculator } from '#services/tax_calculator_service'
import { routeNewOrder, escalateExpiredPreferredOrders } from '#services/order_routing_service'
import { expireCheckoutSession } from '#services/checkout_service'

async function seedOrderRoutingConfig(preferredWindowHours = 24) {
  return OrderRoutingConfig.create({
    name: 'Test order routing',
    version: 1,
    isActive: true,
    preferredWindowHours,
  })
}

async function signupVendor(client: any) {
  const email = `vendor-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Vendor',
    lastName: 'User',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  user.role = 'vendor'
  await user.save()
  const vendor = await Vendor.create({ uuid: string.uuid(), userId: user.id })

  return { session: response.session(), user, vendor }
}

async function grantCapability(vendor: Vendor, technology: 'fdm' | 'sla' | 'sls', isPreferred: boolean) {
  await vendor.related('technologyCapabilities').create({ technology, isPreferred })
}

/** Builds an authorized-and-open order, as authorizeCheckoutSession would. */
async function createOpenOrder(technologies: ('fdm' | 'sla' | 'sls')[] = ['fdm']) {
  const customer = await Customer.create({ uuid: string.uuid() })
  const project = await Project.create({ uuid: string.uuid(), customerId: customer.id, status: 'draft' })
  const quote = await Quote.create({
    uuid: string.uuid(),
    projectId: project.id,
    revision: 1,
    subtotal: '100.00',
    tax: '8.00',
    total: '108.00',
    status: 'accepted',
    generatedBy: 'system',
    destinationCountry: 'US',
    shippingMethod: 'free',
    shippingFeeAmount: '0.00',
    productionTimeBusinessDays: 5,
    productionTimeFeeAmount: '0.00',
  })
  const checkoutSession = await CheckoutSession.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    projectId: project.id,
    customerId: customer.id,
    status: 'active',
    expiresAt: DateTime.now().plus({ hours: 120 }),
  })
  const order = await Order.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    customerId: customer.id,
    projectId: project.id,
    orderNumber: `ORD-${string.generateRandom(6).toUpperCase()}`,
    subtotal: quote.subtotal,
    tax: quote.tax,
    total: quote.total,
    status: 'open',
    shippingMethod: 'free',
    shippingFeeAmount: '0.00',
    productionTimeBusinessDays: 5,
    productionTimeFeeAmount: '0.00',
  })

  for (const technology of technologies) {
    const projectFile = await ProjectFile.create({
      uuid: string.uuid(),
      projectId: project.id,
      fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
      originalName: 'part.stl',
      mimeType: 'model/stl',
      fileSize: 1024,
      status: 'completed',
      technology,
    })
    await order.related('items').create({
      projectFileId: projectFile.id,
      itemType: 'printing',
      description: 'part',
      quantity: 1,
      unitPrice: '100.00',
      total: '100.00',
    })
  }

  const { transactionId } = await fakePaymentGateway.authorize({ amount: 108, metadata: {} })
  const payment = await Payment.create({
    checkoutSessionId: checkoutSession.id,
    provider: 'stripe',
    transactionId,
    amount: '108.00',
    status: 'authorized',
    authorizedAt: DateTime.now(),
    providerFee: '0.00',
    netAmount: '108.00',
  })

  return { project, quote, checkoutSession, order, payment, customer }
}

test.group('Order routing', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    fakePaymentGateway.reset()
    fakeTaxCalculator.reset()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('routes to the preferred queue when a vendor is preferred for every required technology', async ({
    assert,
  }) => {
    await seedOrderRoutingConfig(24)
    const vendorUser = await User.create({
      uuid: string.uuid(),
      email: `v-${string.uuid()}@test.com`,
      password: 'password123',
      role: 'vendor',
    })
    const vendor = await Vendor.create({ uuid: string.uuid(), userId: vendorUser.id })
    await grantCapability(vendor, 'fdm', true)
    const { order } = await createOpenOrder(['fdm'])

    await routeNewOrder(order)

    assert.equal(order.routingStage, 'preferred')
    assert.isNotNull(order.routingExpiresAt)
  })

  test('skips straight to open when no vendor is preferred', async ({ assert }) => {
    await seedOrderRoutingConfig(24)
    const { order } = await createOpenOrder(['fdm'])

    await routeNewOrder(order)

    assert.equal(order.routingStage, 'open')
    assert.isNull(order.routingExpiresAt)
  })

  test('skips to open when a vendor is preferred for only some required technologies', async ({
    assert,
  }) => {
    await seedOrderRoutingConfig(24)
    const vendorUser = await User.create({
      uuid: string.uuid(),
      email: `v-${string.uuid()}@test.com`,
      password: 'password123',
      role: 'vendor',
    })
    const vendor = await Vendor.create({ uuid: string.uuid(), userId: vendorUser.id })
    // Preferred for fdm only, but the order needs fdm AND sla.
    await grantCapability(vendor, 'fdm', true)
    const { order } = await createOpenOrder(['fdm', 'sla'])

    await routeNewOrder(order)

    assert.equal(order.routingStage, 'open')
  })

  test('escalates an expired preferred order to open', async ({ assert }) => {
    await seedOrderRoutingConfig(24)
    const { order } = await createOpenOrder(['fdm'])
    order.routingStage = 'preferred'
    order.routingExpiresAt = DateTime.now().minus({ hours: 1 })
    await order.save()

    const escalated = await escalateExpiredPreferredOrders()

    assert.equal(escalated, 1)
    await order.refresh()
    assert.equal(order.routingStage, 'open')
    assert.isNull(order.routingExpiresAt)
  })

  test('does not escalate a preferred order still inside its window', async ({ assert }) => {
    await seedOrderRoutingConfig(24)
    const { order } = await createOpenOrder(['fdm'])
    order.routingStage = 'preferred'
    order.routingExpiresAt = DateTime.now().plus({ hours: 1 })
    await order.save()

    await escalateExpiredPreferredOrders()

    await order.refresh()
    assert.equal(order.routingStage, 'preferred')
  })
})

test.group('Vendor order acceptance', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await limiter.clear()
    fakePaymentGateway.reset()
    fakeTaxCalculator.reset()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('a preferred vendor can accept a preferred-stage order, capturing payment', async ({
    client,
    assert,
  }) => {
    await seedOrderRoutingConfig(24)
    const { order, checkoutSession, quote } = await createOpenOrder(['fdm'])
    const { calculationId } = await fakeTaxCalculator.calculate({
      lineItems: [{ description: 'x', amount: 100 }],
      destinationCountry: 'US',
      destinationAddress: { line1: '123 Main St', city: 'Springfield', postalCode: '62704' },
    })
    quote.stripeTaxCalculationId = calculationId
    await quote.save()

    const { session, vendor } = await signupVendor(client)
    await grantCapability(vendor, 'fdm', true)
    await routeNewOrder(order)
    assert.equal(order.routingStage, 'preferred')

    const response = await client
      .patch(`/v1/vendor/orders/${order.uuid}/accept`)
      .withSession(session)

    response.assertStatus(200)
    const data = response.body().data as { status: string }
    assert.equal(data.status, 'accepted')

    await order.refresh()
    assert.equal(order.vendorId, vendor.id)

    const payment = await Payment.query().where('checkoutSessionId', checkoutSession.id).firstOrFail()
    assert.equal(payment.status, 'captured')
    assert.isTrue(fakeTaxCalculator.isFinalized(calculationId))

    await checkoutSession.refresh()
    assert.equal(checkoutSession.status, 'completed')

    const history = await OrderStatusHistory.query().where('orderId', order.id)
    assert.lengthOf(history, 1)
    assert.equal(history[0].newStatus, 'accepted')
  })

  test('a non-preferred vendor cannot accept a preferred-stage order', async ({ client }) => {
    await seedOrderRoutingConfig(24)
    const { order } = await createOpenOrder(['fdm'])

    const preferredUser = await User.create({
      uuid: string.uuid(),
      email: `v-${string.uuid()}@test.com`,
      password: 'password123',
      role: 'vendor',
    })
    const preferredVendor = await Vendor.create({ uuid: string.uuid(), userId: preferredUser.id })
    await grantCapability(preferredVendor, 'fdm', true)
    await routeNewOrder(order)

    const { session, vendor } = await signupVendor(client)
    await grantCapability(vendor, 'fdm', false)

    const response = await client
      .patch(`/v1/vendor/orders/${order.uuid}/accept`)
      .withSession(session)

    response.assertStatus(403)
  })

  test('any capable vendor can accept once escalated to open', async ({ client, assert }) => {
    await seedOrderRoutingConfig(24)
    const { order } = await createOpenOrder(['fdm'])
    order.routingStage = 'open'
    order.routingExpiresAt = null
    await order.save()

    const { session, vendor } = await signupVendor(client)
    await grantCapability(vendor, 'fdm', false)

    const response = await client
      .patch(`/v1/vendor/orders/${order.uuid}/accept`)
      .withSession(session)

    response.assertStatus(200)
    assert.equal((response.body().data as { status: string }).status, 'accepted')
  })

  test('a vendor without the required capability cannot accept', async ({ client }) => {
    await seedOrderRoutingConfig(24)
    const { order } = await createOpenOrder(['sla'])
    order.routingStage = 'open'
    await order.save()

    const { session, vendor } = await signupVendor(client)
    await grantCapability(vendor, 'fdm', false)

    const response = await client
      .patch(`/v1/vendor/orders/${order.uuid}/accept`)
      .withSession(session)

    response.assertStatus(403)
  })

  test('a second vendor cannot accept an order someone else already took', async ({
    client,
    assert,
  }) => {
    await seedOrderRoutingConfig(24)
    const { order } = await createOpenOrder(['fdm'])
    order.routingStage = 'open'
    await order.save()

    const first = await signupVendor(client)
    await grantCapability(first.vendor, 'fdm', false)
    const firstResponse = await client
      .patch(`/v1/vendor/orders/${order.uuid}/accept`)
      .withSession(first.session)
    firstResponse.assertStatus(200)

    const second = await signupVendor(client)
    await grantCapability(second.vendor, 'fdm', false)
    const secondResponse = await client
      .patch(`/v1/vendor/orders/${order.uuid}/accept`)
      .withSession(second.session)

    secondResponse.assertStatus(409)

    const orders = await Order.query().where('id', order.id)
    assert.equal(orders[0].vendorId, first.vendor.id)
  })

  test('a non-vendor user cannot access vendor endpoints', async ({ client }) => {
    const email = `customer-${string.uuid()}@test.com`
    const signupResponse = await client.post('/v1/auth/new-customer').json({
      firstName: 'Not',
      lastName: 'Vendor',
      email,
      password: 'password123',
    })

    const response = await client.get('/v1/vendor/orders').withSession(signupResponse.session())

    response.assertStatus(403)
  })

  test('vendor listing only returns orders the vendor is currently eligible for', async ({
    client,
    assert,
  }) => {
    await seedOrderRoutingConfig(24)
    const { order: preferredOrder } = await createOpenOrder(['fdm'])
    const { order: otherTechOrder } = await createOpenOrder(['sla'])
    otherTechOrder.routingStage = 'open'
    await otherTechOrder.save()

    const { session, vendor } = await signupVendor(client)
    await grantCapability(vendor, 'fdm', true)
    await routeNewOrder(preferredOrder)

    const response = await client.get('/v1/vendor/orders').withSession(session)

    response.assertStatus(200)
    const orders = response.body().data as { uuid: string }[]
    assert.sameMembers(
      orders.map((o) => o.uuid),
      [preferredOrder.uuid]
    )
  })
})

test.group('Checkout expiration', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    fakePaymentGateway.reset()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('releases the hold and cancels the order when no vendor accepted in time', async ({
    assert,
  }) => {
    const { order, checkoutSession, payment } = await createOpenOrder(['fdm'])
    checkoutSession.expiresAt = DateTime.now().minus({ hours: 1 })
    await checkoutSession.save()

    await expireCheckoutSession(checkoutSession)

    await checkoutSession.refresh()
    assert.equal(checkoutSession.status, 'expired')
    await order.refresh()
    assert.equal(order.status, 'cancelled')
    await payment.refresh()
    assert.equal(payment.status, 'cancelled')
  })

  test('does not release a hold whose order was already accepted', async ({ assert }) => {
    const { order, checkoutSession, payment } = await createOpenOrder(['fdm'])
    order.status = 'accepted'
    await order.save()
    payment.status = 'captured'
    await payment.save()
    checkoutSession.status = 'completed'
    await checkoutSession.save()

    // Simulate the job still finding this session if it were (incorrectly)
    // still active/expired - the order-status check must be what protects it.
    checkoutSession.status = 'active'
    checkoutSession.expiresAt = DateTime.now().minus({ hours: 1 })
    await checkoutSession.save()

    await expireCheckoutSession(checkoutSession)

    await order.refresh()
    assert.equal(order.status, 'accepted')
    await payment.refresh()
    assert.equal(payment.status, 'captured')
  })
})
