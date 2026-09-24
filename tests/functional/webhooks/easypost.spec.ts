import { createHmac } from 'node:crypto'
import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import env from '#start/env'
import Address from '#models/address'
import Customer from '#models/customer'
import Order from '#models/order'
import OrderStatusHistory from '#models/order_status_history'
import Project from '#models/project'
import Shipment from '#models/shipment'
import Vendor from '#models/vendor'
import User from '#models/user'
import WebhookEvent from '#models/webhook_event'

const webhookSecret = env.get('EASYPOST_WEBHOOK_SECRET')!

/** EasyPost's scheme: HMAC-SHA256 of the raw body, hex, with a fixed prefix. */
function sign(payload: string) {
  return `hmac-sha256-hex=${createHmac('sha256', webhookSecret).update(payload, 'utf8').digest('hex')}`
}

/** A `ready_to_ship` order with a bought label (shipment `label_created`). */
async function createLabelledOrder(status: Order['status'] = 'ready_to_ship') {
  const user = await User.create({
    uuid: string.uuid(),
    email: `vendor-${string.uuid()}@test.com`,
    password: 'password123',
    role: 'vendor',
  })
  const vendor = await Vendor.create({ uuid: string.uuid(), userId: user.id })
  const customer = await Customer.create({ uuid: string.uuid() })
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer.id,
    status: 'ordered',
  })
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
    shippingMethod: 'free',
    shippingFeeAmount: '0.00',
    status,
  })
  const shipment = await Shipment.create({
    uuid: string.uuid(),
    orderId: order.id,
    vendorId: vendor.id,
    addressId: address.id,
    status: 'label_created',
    carrier: 'USPS',
    serviceLevel: 'GroundAdvantage',
    trackingNumber: `EZ${string.generateRandom(10).toUpperCase()}`,
    easypostShipmentId: `shp_${string.generateRandom(12)}`,
    labelCreatedAt: DateTime.now(),
    weightOz: '12.00',
    lengthIn: '8.00',
    widthIn: '6.00',
    heightIn: '4.00',
  })
  return { order, shipment }
}

function trackerEvent(
  shipment: Shipment,
  status: string,
  overrides: { eventId?: string; description?: string; updatedAt?: string } = {}
) {
  return JSON.stringify({
    id: overrides.eventId ?? `evt_${string.generateRandom(12)}`,
    object: 'Event',
    description: overrides.description ?? 'tracker.updated',
    result: {
      id: `trk_${string.generateRandom(12)}`,
      object: 'Tracker',
      status,
      tracking_code: shipment.trackingNumber,
      shipment_id: shipment.easypostShipmentId,
      public_url: 'https://track.easypost.com/fake',
      updated_at: overrides.updatedAt ?? DateTime.now().toISO(),
    },
  })
}

function post(client: any, payload: string, signature = sign(payload)) {
  return client
    .post('/v1/webhooks/easypost')
    .header('x-hmac-signature', signature)
    .header('content-type', 'application/json')
    .json(JSON.parse(payload))
}

async function postOk(client: any, payload: string) {
  const response = await post(client, payload)
  response.assertStatus(200)
}

test.group('Webhooks | EasyPost tracker', (group) => {
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

  test('rejects an invalid signature', async ({ client }) => {
    const { shipment } = await createLabelledOrder()
    const payload = trackerEvent(shipment, 'in_transit')

    const response = await post(client, payload, 'hmac-sha256-hex=deadbeef')
    response.assertStatus(400)
  })

  test('the first in-transit scan ships the order', async ({ client, assert }) => {
    const { order, shipment } = await createLabelledOrder()

    const response = await post(client, trackerEvent(shipment, 'in_transit'))
    response.assertStatus(200)

    await shipment.refresh()
    assert.equal(shipment.status, 'in_transit')
    assert.equal(shipment.trackerStatus, 'in_transit')
    assert.isNotNull(shipment.shippedAt)

    await order.refresh()
    assert.equal(order.status, 'shipped')
    assert.isNotNull(order.shippedAt)
    assert.isNull(order.deliveredAt)

    const history = await OrderStatusHistory.query().where('orderId', order.id)
    assert.lengthOf(history, 1)
    assert.equal(history[0].oldStatus, 'ready_to_ship')
    assert.equal(history[0].newStatus, 'shipped')
    assert.isNull(history[0].changedById)
  })

  test('pre_transit records the tracker status but moves nothing', async ({ client, assert }) => {
    const { order, shipment } = await createLabelledOrder()

    await postOk(client, trackerEvent(shipment, 'pre_transit', { description: 'tracker.created' }))

    await shipment.refresh()
    assert.equal(shipment.status, 'label_created')
    assert.equal(shipment.trackerStatus, 'pre_transit')
    await order.refresh()
    assert.equal(order.status, 'ready_to_ship')
  })

  test('delivery marks the order delivered and stamps delivered_at for payouts', async ({
    client,
    assert,
  }) => {
    const { order, shipment } = await createLabelledOrder()
    const deliveredAt = '2026-09-20T15:30:00.000Z'

    await postOk(client, trackerEvent(shipment, 'in_transit'))
    await postOk(client, trackerEvent(shipment, 'delivered', { updatedAt: deliveredAt }))

    await shipment.refresh()
    assert.equal(shipment.status, 'delivered')
    await order.refresh()
    assert.equal(order.status, 'delivered')
    assert.equal(order.deliveredAt?.toUTC().toISO(), deliveredAt)

    const history = await OrderStatusHistory.query().where('orderId', order.id).orderBy('id')
    assert.deepEqual(
      history.map((row) => `${row.oldStatus}->${row.newStatus}`),
      ['ready_to_ship->shipped', 'shipped->delivered']
    )
  })

  test('a delivery with no prior scan still passes through shipped', async ({ client, assert }) => {
    const { order, shipment } = await createLabelledOrder()

    await postOk(client, trackerEvent(shipment, 'delivered'))

    await order.refresh()
    assert.equal(order.status, 'delivered')
    assert.isNotNull(order.shippedAt)
    assert.isNotNull(order.deliveredAt)

    const history = await OrderStatusHistory.query().where('orderId', order.id).orderBy('id')
    assert.deepEqual(
      history.map((row) => `${row.oldStatus}->${row.newStatus}`),
      ['ready_to_ship->shipped', 'shipped->delivered']
    )
  })

  test('a late in_transit event after delivery is ignored', async ({ client, assert }) => {
    const { order, shipment } = await createLabelledOrder()

    await postOk(client, trackerEvent(shipment, 'delivered'))
    await postOk(client, trackerEvent(shipment, 'in_transit'))

    await shipment.refresh()
    assert.equal(shipment.status, 'delivered')
    assert.equal(shipment.trackerStatus, 'delivered')
    await order.refresh()
    assert.equal(order.status, 'delivered')
  })

  test('the same event delivered twice is only applied once', async ({ client, assert }) => {
    const { order, shipment } = await createLabelledOrder()
    const payload = trackerEvent(shipment, 'in_transit', { eventId: 'evt_duplicate' })

    await postOk(client, payload)
    await postOk(client, payload)

    assert.lengthOf(await OrderStatusHistory.query().where('orderId', order.id), 1)
    assert.lengthOf(await WebhookEvent.query().where('eventId', 'evt_duplicate'), 1)
  })

  test('an event for an unknown shipment is acknowledged and ignored', async ({
    client,
    assert,
  }) => {
    const payload = JSON.stringify({
      id: 'evt_unknown',
      object: 'Event',
      description: 'tracker.updated',
      result: { status: 'delivered', tracking_code: 'NOPE', shipment_id: 'shp_nope' },
    })

    const response = await post(client, payload)
    response.assertStatus(200)
    assert.lengthOf(await WebhookEvent.query().where('eventId', 'evt_unknown'), 1)
  })

  test('delivery of a refunded order leaves the order refunded', async ({ client, assert }) => {
    const { order, shipment } = await createLabelledOrder('refunded')

    const response = await post(client, trackerEvent(shipment, 'delivered'))
    response.assertStatus(200)

    await shipment.refresh()
    assert.equal(shipment.status, 'delivered')
    await order.refresh()
    assert.equal(order.status, 'refunded')
    assert.isNull(order.deliveredAt)
    assert.lengthOf(await OrderStatusHistory.query().where('orderId', order.id), 0)
  })

  test('a scan on a voided label is recorded but never moves the order', async ({
    client,
    assert,
  }) => {
    const { order, shipment } = await createLabelledOrder()
    shipment.merge({ status: 'cancelled', cancelledAt: DateTime.now() })
    await shipment.save()
    await postOk(client, trackerEvent(shipment, 'in_transit'))

    await shipment.refresh()
    assert.equal(shipment.status, 'cancelled')
    assert.equal(shipment.trackerStatus, 'in_transit')
    await order.refresh()
    assert.equal(order.status, 'ready_to_ship')
  })
})
