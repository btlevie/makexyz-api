import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Order from '#models/order'
import OrderStatusHistory from '#models/order_status_history'
import Payment from '#models/payment'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import User from '#models/user'
import Vendor from '#models/vendor'
import { fakePaymentGateway } from '#services/payment_gateway_service'

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

/** An order already accepted by `vendor`, ready to move through production. */
async function createAcceptedOrder(vendor: Vendor, status: Order['status'] = 'accepted') {
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
    status: 'completed',
    expiresAt: DateTime.now().plus({ hours: 120 }),
  })
  const order = await Order.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    customerId: customer.id,
    projectId: project.id,
    vendorId: vendor.id,
    orderNumber: `ORD-${string.generateRandom(6).toUpperCase()}`,
    subtotal: quote.subtotal,
    tax: quote.tax,
    total: quote.total,
    status,
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
  })
  await order.related('items').create({
    projectFileId: projectFile.id,
    itemType: 'printing',
    description: 'part',
    quantity: 1,
    unitPrice: '100.00',
    total: '100.00',
  })
  const { transactionId } = await fakePaymentGateway.authorize({ amount: 108, metadata: {} })
  await Payment.create({
    checkoutSessionId: checkoutSession.id,
    provider: 'stripe',
    transactionId,
    amount: '108.00',
    status: 'captured',
    capturedAt: DateTime.now(),
    providerFee: '0.00',
    netAmount: '108.00',
  })

  return { customer, project, quote, checkoutSession, order }
}

test.group('Order production tracking', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(() => {
    fakePaymentGateway.reset()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('a vendor can start production on their accepted order', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createAcceptedOrder(vendor)

    const response = await client
      .patch(`/v1/vendor/orders/${order.uuid}/start-production`)
      .withSession(session)

    response.assertStatus(200)
    assert.equal((response.body().data as { status: string }).status, 'in_progress')

    const history = await OrderStatusHistory.query().where('orderId', order.id)
    assert.lengthOf(history, 1)
    assert.equal(history[0].oldStatus, 'accepted')
    assert.equal(history[0].newStatus, 'in_progress')
  })

  test('refuses to start production on an order not in accepted', async ({ client }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createAcceptedOrder(vendor, 'open')

    const response = await client
      .patch(`/v1/vendor/orders/${order.uuid}/start-production`)
      .withSession(session)

    response.assertStatus(409)
  })

  test("refuses to start production on another vendor's order", async ({ client }) => {
    const owner = await signupVendor(client)
    const { order } = await createAcceptedOrder(owner.vendor)

    const intruder = await signupVendor(client)
    const response = await client
      .patch(`/v1/vendor/orders/${order.uuid}/start-production`)
      .withSession(intruder.session)

    response.assertStatus(403)
  })

  test('a vendor can mark an in-progress order ready to ship', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createAcceptedOrder(vendor, 'in_progress')

    const response = await client
      .patch(`/v1/vendor/orders/${order.uuid}/ready-to-ship`)
      .withSession(session)

    response.assertStatus(200)
    assert.equal((response.body().data as { status: string }).status, 'ready_to_ship')

    const history = await OrderStatusHistory.query().where('orderId', order.id)
    assert.lengthOf(history, 1)
    assert.equal(history[0].oldStatus, 'in_progress')
    assert.equal(history[0].newStatus, 'ready_to_ship')
  })

  test('refuses ready-to-ship on an order still only accepted', async ({ client }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createAcceptedOrder(vendor, 'accepted')

    const response = await client
      .patch(`/v1/vendor/orders/${order.uuid}/ready-to-ship`)
      .withSession(session)

    response.assertStatus(409)
  })

  test('lists only this vendor\'s active orders, excluding open/shipped/other vendors\'', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await signupVendor(client)
    const { order: accepted } = await createAcceptedOrder(vendor, 'accepted')
    const { order: inProgress } = await createAcceptedOrder(vendor, 'in_progress')
    const { order: readyToShip } = await createAcceptedOrder(vendor, 'ready_to_ship')
    const { order: shipped } = await createAcceptedOrder(vendor, 'shipped')

    const other = await signupVendor(client)
    const { order: othersOrder } = await createAcceptedOrder(other.vendor, 'accepted')

    const response = await client.get('/v1/vendor/orders/active').withSession(session)

    response.assertStatus(200)
    const uuids = (response.body().data as { uuid: string }[]).map((o) => o.uuid)
    assert.sameMembers(uuids, [accepted.uuid, inProgress.uuid, readyToShip.uuid])
    assert.notInclude(uuids, shipped.uuid)
    assert.notInclude(uuids, othersOrder.uuid)
  })

  test('a non-vendor user cannot access production endpoints', async ({ client }) => {
    const email = `customer-${string.uuid()}@test.com`
    const signupResponse = await client.post('/v1/auth/new-customer').json({
      firstName: 'Not',
      lastName: 'Vendor',
      email,
      password: 'password123',
    })

    const response = await client
      .get('/v1/vendor/orders/active')
      .withSession(signupResponse.session())

    response.assertStatus(403)
  })
})
