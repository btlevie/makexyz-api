import string from '@adonisjs/core/helpers/string'
import { DateTime } from 'luxon'
import Customer from '#models/customer'
import Order from '#models/order'
import Project from '#models/project'
import User from '#models/user'
import Vendor from '#models/vendor'
import { activeVendorAttributes, signupAs } from '#tests/helpers/vendors'

/** A signed-in customer whose email is already verified - able to message vendors. */
export async function verifiedCustomer(client: any) {
  const { session, user } = await signupAs(client, 'customer')
  user.emailVerifiedAt = DateTime.now()
  await user.save()
  const customer = await Customer.findByOrFail('userId', user.id)
  return { session, user, customer }
}

/** A signed-in, active vendor (through the public signup for a session). */
export async function activeVendor(client: any, displayName = 'Acme Print') {
  const email = `vendor-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Vendor',
    lastName: 'User',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  user.merge({ role: 'vendor', emailVerifiedAt: DateTime.now() })
  await user.save()
  const vendor = await Vendor.create({
    uuid: string.uuid(),
    userId: user.id,
    displayName,
    ...activeVendorAttributes(),
  })
  return { session: response.session(), user, vendor }
}

/** A message payload with a fresh idempotency key. */
export function messagePayload(body: string) {
  return { body, clientMessageId: string.uuid() }
}

export async function startInquiry(
  client: any,
  session: any,
  vendor: Vendor,
  body = 'Hi - could you print 20 of these brackets in PETG by next Friday?',
  subject = 'Bracket run'
) {
  return client
    .post(`/v1/vendors/${vendor.uuid}/inquiries`)
    .withSession(session)
    .json({ subject, ...messagePayload(body) })
}

/** An accepted instant-quote order between a customer and vendor, without going through checkout. */
export async function acceptedOrder(
  customer: Customer,
  vendor: Vendor,
  status: Order['status'] = 'accepted'
) {
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer.id,
    status: 'ordered',
  })
  return Order.create({
    uuid: string.uuid(),
    customerId: customer.id,
    projectId: project.id,
    vendorId: vendor.id,
    orderNumber: `ORD-${string.generateRandom(10).toUpperCase()}`,
    subtotal: '100.00',
    tax: '8.00',
    total: '108.00',
    status,
    shippingMethod: 'free',
    shippingFeeAmount: '0.00',
    productionTimeBusinessDays: 5,
    productionTimeFeeAmount: '0.00',
  })
}

/**
 * A response's `data`, untyped. The api-client types bodies from the route
 * registry as unions (single object | list), which isn't useful in assertions.
 */
export function dataOf(response: { body(): unknown }): any {
  return (response.body() as { data: unknown }).data
}

/** A sent mail's plain-text body. */
export function mailText(sent: { message: { toJSON(): { message: { text?: unknown } } } }): string {
  return String(sent.message.toJSON().message.text ?? '')
}
