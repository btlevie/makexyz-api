import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Address from '#models/address'
import Customer from '#models/customer'
import Order from '#models/order'
import Project from '#models/project'
import Shipment from '#models/shipment'
import ShippingLabel from '#models/shipping_label'
import User from '#models/user'
import Vendor from '#models/vendor'
import { fakeShippingLabelGateway } from '#services/shipping_label_gateway_service'

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

type OrderOptions = {
  status?: Order['status']
  source?: Project['source']
  country?: string
  shippingMethod?: NonNullable<Order['shippingMethod']>
  customer?: Customer
}

/** A `ready_to_ship` instant-quote order claimed by `vendor`, with a ship-to address. */
async function createShippableOrder(vendor: Vendor, options: OrderOptions = {}) {
  const customer = options.customer ?? (await Customer.create({ uuid: string.uuid() }))
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer.id,
    status: 'ordered',
    source: options.source ?? 'instant_quote',
  })
  const address = await Address.create({
    uuid: string.uuid(),
    ownerType: 'customer',
    customerId: customer.id,
    recipientName: 'Jane Doe',
    line1: '123 Main St',
    city: options.country && options.country !== 'US' ? 'Toronto' : 'Springfield',
    state: options.country && options.country !== 'US' ? 'ON' : 'IL',
    postalCode: options.country && options.country !== 'US' ? 'M5V 2T6' : '62704',
    country: options.country ?? 'US',
  })
  const order = await Order.create({
    uuid: string.uuid(),
    customerId: customer.id,
    projectId: project.id,
    vendorId: vendor.id,
    addressId: address.id,
    orderNumber: `ORD-${string.generateRandom(6).toUpperCase()}`,
    subtotal: '100.00',
    tax: '8.00',
    total: '108.00',
    shippingMethod: options.shippingMethod ?? 'free',
    shippingFeeAmount: '0.00',
    status: options.status ?? 'ready_to_ship',
  })
  return { customer, project, address, order }
}

const parcel = { weightOz: 12, lengthIn: 8, widthIn: 6, heightIn: 4 }

function buyLabel(client: any, session: any, order: Order, body: Record<string, any> = { parcel }) {
  return client.post(`/v1/vendor/orders/${order.uuid}/shipments`).withSession(session).json(body)
}

async function buyLabelOk(client: any, session: any, order: Order) {
  const response = await buyLabel(client, session, order)
  response.assertStatus(200)
  return response
}

test.group('Vendor shipping labels', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(() => {
    fakeShippingLabelGateway.reset()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('buys a label from MakeXYZ, picking the service the customer paid for', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor, { shippingMethod: 'ups_2day' })

    const response = await buyLabel(client, session, order)
    response.assertStatus(200)

    const data = response.body().data as Record<string, any>
    assert.equal(data.status, 'label_created')
    assert.equal(data.carrier, 'UPS')
    assert.equal(data.serviceLevel, '2ndDayAir')
    assert.isString(data.trackingNumber)
    assert.isString(data.label.labelPdfUrl)
    assert.equal(data.label.cost, '24.00')

    // Origin and return are MakeXYZ, never the vendor.
    const sent = fakeShippingLabelGateway.lastCreateParams!
    assert.equal(sent.fromAddress.name, 'MakeXYZ Fulfillment')
    assert.equal(sent.fromAddress.street1, '100 Test Way')
    assert.deepEqual(sent.returnAddress, sent.fromAddress)
    assert.equal(sent.toAddress.name, 'Jane Doe')
    assert.isNull(sent.customs)
    assert.equal(sent.reference, order.orderNumber)

    const shipment = await Shipment.findByOrFail('uuid', data.uuid)
    assert.equal(shipment.orderId, order.id)
    assert.isNull(shipment.labelPurchaseStartedAt)
    assert.lengthOf(await ShippingLabel.query().where('shipmentId', shipment.id), 1)

    // Buying the label doesn't move the order - the carrier's scan does.
    await order.refresh()
    assert.equal(order.status, 'ready_to_ship')
  })

  test('free shipping buys the cheapest USPS rate', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor, { shippingMethod: 'free' })

    const response = await buyLabel(client, session, order)
    response.assertStatus(200)
    const data = response.body().data as Record<string, any>
    assert.equal(data.carrier, 'USPS')
    assert.equal(data.serviceLevel, 'GroundAdvantage')
  })

  test('refuses orders that did not come from the instant quote', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor, { source: 'manual' })

    const response = await buyLabel(client, session, order)
    response.assertStatus(403)
    assert.equal(fakeShippingLabelGateway.purchaseCount, 0)
    assert.lengthOf(await Shipment.all(), 0)
  })

  test('refuses an order that is not ready to ship', async ({ client }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor, { status: 'in_progress' })

    const response = await buyLabel(client, session, order)
    response.assertStatus(409)
  })

  test("refuses another vendor's order", async ({ client }) => {
    const { vendor: owner } = await signupVendor(client)
    const { session: otherSession } = await signupVendor(client)
    const { order } = await createShippableOrder(owner)

    const response = await buyLabel(client, otherSession, order)
    response.assertStatus(403)
  })

  test('refuses a non-vendor user', async ({ client }) => {
    const { vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor)
    const customerSignup = await client.post('/v1/auth/new-customer').json({
      firstName: 'Just',
      lastName: 'Customer',
      email: `customer-${string.uuid()}@test.com`,
      password: 'password123',
    })

    const response = await buyLabel(client, customerSignup.session(), order)
    response.assertStatus(403)
  })

  test('validates the parcel', async ({ client }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor)

    const response = await buyLabel(client, session, order, {
      parcel: { weightOz: 0, lengthIn: 8, widthIn: 6 },
    })
    response.assertStatus(422)
  })

  test('refuses a second label while one is live', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor)

    await buyLabelOk(client, session, order)
    const second = await buyLabel(client, session, order)
    second.assertStatus(409)
    assert.equal(fakeShippingLabelGateway.purchaseCount, 1)
  })

  test('refuses while another request holds the purchase lease', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor)
    await Shipment.create({
      uuid: string.uuid(),
      orderId: order.id,
      vendorId: vendor.id,
      addressId: order.addressId,
      status: 'pending',
      labelPurchaseStartedAt: DateTime.now(),
      weightOz: '12.00',
      lengthIn: '8.00',
      widthIn: '6.00',
      heightIn: '4.00',
    })

    const response = await buyLabel(client, session, order)
    response.assertStatus(409)
    assert.equal(fakeShippingLabelGateway.purchaseCount, 0)
  })

  test('takes over a stale lease left by a crashed request', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor)
    await Shipment.create({
      uuid: string.uuid(),
      orderId: order.id,
      vendorId: vendor.id,
      addressId: order.addressId,
      status: 'pending',
      labelPurchaseStartedAt: DateTime.now().minus({ minutes: 10 }),
      weightOz: '1.00',
      lengthIn: '1.00',
      widthIn: '1.00',
      heightIn: '1.00',
    })

    const response = await buyLabel(client, session, order)
    response.assertStatus(200)
    assert.lengthOf(await Shipment.all(), 1)
    const shipment = await Shipment.firstOrFail()
    assert.equal(shipment.status, 'label_created')
    assert.equal(Number(shipment.weightOz), 12)
  })

  test('returns 422 and keeps nothing when no carrier rate matches', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor)
    fakeShippingLabelGateway.noRates = true

    const response = await buyLabel(client, session, order)
    response.assertStatus(422)
    assert.lengthOf(await Shipment.all(), 0)
  })

  test('returns 502 and drops the pending row when EasyPost create fails', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor)
    fakeShippingLabelGateway.failNextCreate = true

    const response = await buyLabel(client, session, order)
    response.assertStatus(502)
    assert.lengthOf(await Shipment.all(), 0)

    // Nothing blocks an immediate retry.
    await buyLabelOk(client, session, order)
  })

  test('recovers a label bought at EasyPost when our side failed, without buying twice', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor)
    fakeShippingLabelGateway.failNextBuyAfterPurchase = true

    const failed = await buyLabel(client, session, order)
    failed.assertStatus(502)
    assert.equal(fakeShippingLabelGateway.purchaseCount, 1)

    const pending = await Shipment.firstOrFail()
    assert.equal(pending.status, 'pending')
    assert.isNotNull(pending.easypostShipmentId)
    assert.isNull(pending.labelPurchaseStartedAt)

    const retry = await buyLabel(client, session, order)
    retry.assertStatus(200)
    assert.equal(fakeShippingLabelGateway.purchaseCount, 1)

    const data = retry.body().data as Record<string, any>
    assert.equal(data.uuid, pending.uuid)
    assert.equal(data.status, 'label_created')
    assert.lengthOf(await ShippingLabel.all(), 1)
  })

  test('international orders require customs items', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor, {
      country: 'CA',
      shippingMethod: 'international_expedited',
    })

    const missing = await buyLabel(client, session, order)
    missing.assertStatus(422)

    const response = await buyLabel(client, session, order, {
      parcel,
      customsItems: [
        { description: '3D printed plastic part', quantity: 2, value: 100, weightOz: 12 },
      ],
    })
    response.assertStatus(200)

    const sent = fakeShippingLabelGateway.lastCreateParams!
    assert.equal(sent.customs?.signer, 'MakeXYZ Fulfillment')
    assert.equal(sent.customs?.items[0].originCountry, 'US')
    assert.equal((response.body().data as Record<string, any>).carrier, 'UPS')
  })

  test('voids an unscanned label so a new one can be bought', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor)

    const first = await buyLabel(client, session, order)
    const firstUuid = (first.body().data as { uuid: string }).uuid

    const voidResponse = await client
      .post(`/v1/vendor/orders/${order.uuid}/shipments/${firstUuid}/void`)
      .withSession(session)
    voidResponse.assertStatus(200)
    const voided = voidResponse.body().data as Record<string, any>
    assert.equal(voided.status, 'cancelled')
    assert.isNotNull(voided.label.voidedAt)
    assert.equal(voided.label.refundStatus, 'submitted')

    const second = await buyLabel(client, session, order)
    second.assertStatus(200)
    assert.notEqual((second.body().data as { uuid: string }).uuid, firstUuid)

    const list = await client.get(`/v1/vendor/orders/${order.uuid}/shipments`).withSession(session)
    list.assertStatus(200)
    const shipments = list.body().data as Record<string, any>[]
    assert.lengthOf(shipments, 2)
    assert.equal(shipments[0].status, 'label_created')
    assert.equal(shipments[1].status, 'cancelled')
  })

  test('refuses to void a label the carrier has already scanned', async ({ client }) => {
    const { session, vendor } = await signupVendor(client)
    const { order } = await createShippableOrder(vendor)
    const bought = await buyLabel(client, session, order)
    const uuid = (bought.body().data as { uuid: string }).uuid
    await Shipment.query().where('uuid', uuid).update({ status: 'in_transit' })

    const response = await client
      .post(`/v1/vendor/orders/${order.uuid}/shipments/${uuid}/void`)
      .withSession(session)
    response.assertStatus(409)
  })

  test('customers see tracking on their order, but never the label', async ({ client, assert }) => {
    const { session: vendorSession, vendor } = await signupVendor(client)
    const email = `customer-${string.uuid()}@test.com`
    const customerSignup = await client.post('/v1/auth/new-customer').json({
      firstName: 'Just',
      lastName: 'Customer',
      email,
      password: 'password123',
    })
    const user = await User.findByOrFail('email', email)
    const customer = await Customer.findByOrFail('userId', user.id)
    const { project, order } = await createShippableOrder(vendor, { customer })
    await buyLabelOk(client, vendorSession, order)

    const response = await client
      .get(`/v1/projects/${project.uuid}/order`)
      .withSession(customerSignup.session())
    response.assertStatus(200)

    const shipments = (response.body().data as Record<string, any>[])[0].shipments
    assert.lengthOf(shipments, 1)
    assert.isString(shipments[0].trackingNumber)
    assert.notProperty(shipments[0], 'label')
  })
})
