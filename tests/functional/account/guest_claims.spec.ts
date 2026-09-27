import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import mail from '@adonisjs/mail/services/main'
import { DateTime } from 'luxon'
import GuestClaimNotification from '#mails/guest_claim_notification'
import Address from '#models/address'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Order from '#models/order'
import Project from '#models/project'
import Quote from '#models/quote'
import User from '#models/user'
import { issueGrant } from '#services/project_grant_service'
import { signedClaimPath } from '#services/guest_claim_service'

/**
 * A project with a configured quote, its shipping address, an active checkout
 * session and the resulting order - everything customer_claim_service moves.
 */
async function projectWithOrder(customerId: number | null) {
  const project = await Project.create({ uuid: string.uuid(), customerId, status: 'draft' })
  const address = await Address.create({
    uuid: string.uuid(),
    ownerType: 'customer',
    customerId,
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
    addressId: address.id,
  })
  const checkoutSession = await CheckoutSession.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    projectId: project.id,
    customerId,
    status: 'active',
    expiresAt: DateTime.now().plus({ hours: 120 }),
  })
  const order = await Order.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    customerId,
    projectId: project.id,
    orderNumber: `ORD-${string.generateRandom(10).toUpperCase()}`,
    subtotal: '100.00',
    tax: '8.00',
    total: '108.00',
    status: 'open',
    shippingMethod: 'free',
    shippingFeeAmount: '0.00',
    productionTimeBusinessDays: 5,
    productionTimeFeeAmount: '0.00',
    addressId: address.id,
  })

  return { project, address, quote, checkoutSession, order }
}

async function guestCustomer(email: string) {
  return Customer.create({ uuid: string.uuid(), email })
}

function signup(client: any, email: string, grant?: string) {
  const request = client.post('/v1/auth/new-customer')
  if (grant) {
    request.header('x-project-grant', grant)
  }
  return request.json({ firstName: 'Jane', lastName: 'Doe', email, password: 'password123' })
}

async function accountCustomer(email: string) {
  const user = await User.findByOrFail('email', email)
  const customer = await Customer.findByOrFail('userId', user.id)
  return { user, customer }
}

test.group('Account | guest claims', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await limiter.clear()
    return async () => {
      mail.restore()
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('signup with a grant attaches that guest project and its order', async ({
    client,
    assert,
  }) => {
    mail.fake()
    const guest = await guestCustomer('someone@example.com')
    const { project, address, checkoutSession, order } = await projectWithOrder(guest.id)
    // A second guest project stays put - the grant proves only one.
    const other = await projectWithOrder(guest.id)

    const response = await signup(client, 'jane@example.com', issueGrant(project))
    response.assertStatus(200)

    const { customer } = await accountCustomer('jane@example.com')
    await project.refresh()
    await address.refresh()
    await checkoutSession.refresh()
    await order.refresh()
    assert.equal(project.customerId, customer.id)
    assert.equal(address.customerId, customer.id)
    assert.equal(checkoutSession.customerId, customer.id)
    assert.equal(order.customerId, customer.id)

    await other.project.refresh()
    assert.equal(other.project.customerId, guest.id)
  })

  test('signup with a grant attaches a project that had no customer yet', async ({
    client,
    assert,
  }) => {
    mail.fake()
    const project = await Project.create({ uuid: string.uuid(), customerId: null, status: 'draft' })

    const response = await signup(client, 'jane@example.com', issueGrant(project))
    response.assertStatus(200)

    const { customer } = await accountCustomer('jane@example.com')
    await project.refresh()
    assert.equal(project.customerId, customer.id)
  })

  test("signup never takes another account's project, and still succeeds", async ({
    client,
    assert,
  }) => {
    mail.fake()
    const ownerSignup = await signup(client, 'owner@example.com')
    ownerSignup.assertStatus(200)
    const { customer: owner } = await accountCustomer('owner@example.com')
    const { project } = await projectWithOrder(owner.id)

    const response = await signup(client, 'jane@example.com', issueGrant(project))
    response.assertStatus(200)

    await project.refresh()
    assert.equal(project.customerId, owner.id)
  })

  test('signup ignores a tampered grant', async ({ client, assert }) => {
    mail.fake()
    const project = await Project.create({ uuid: string.uuid(), customerId: null, status: 'draft' })

    const response = await signup(client, 'jane@example.com', `${issueGrant(project)}tampered`)
    response.assertStatus(200)

    await project.refresh()
    assert.isNull(project.customerId)
  })

  test('signup emails a claim link when guest work exists under that email', async ({ client }) => {
    const { mails } = mail.fake()
    const guest = await guestCustomer('jane@example.com')
    await projectWithOrder(guest.id)

    const response = await signup(client, 'Jane@Example.com')
    response.assertStatus(200)

    mails.assertSentCount(GuestClaimNotification, 1)
    mails.assertSent(GuestClaimNotification, (sent) => sent.message.hasTo('jane@example.com'))
  })

  test('signup sends nothing without guest work under that email', async ({ client }) => {
    const { mails } = mail.fake()
    // A lead with no projects (nothing to claim) and a different email's work.
    await guestCustomer('jane@example.com')
    const otherGuest = await guestCustomer('other@example.com')
    await projectWithOrder(otherGuest.id)

    const response = await signup(client, 'jane@example.com')
    response.assertStatus(200)

    mails.assertNoneSent()
  })

  test('confirming a claim merges the guest into the account', async ({ client, assert }) => {
    mail.fake()
    const guest = await guestCustomer('jane@example.com')
    guest.marketingOptIn = true
    guest.marketingOptInUpdatedAt = DateTime.now()
    await guest.save()
    const first = await projectWithOrder(guest.id)
    const second = await projectWithOrder(guest.id)

    const signupResponse = await signup(client, 'jane@example.com')
    signupResponse.assertStatus(200)
    const { user, customer } = await accountCustomer('jane@example.com')

    const response = await client
      .post(signedClaimPath(guest, user))
      .withSession(signupResponse.session())

    response.assertStatus(200)
    response.assertBodyContains({ data: { projects: 2, orders: 2 } })

    for (const { project, order, address, checkoutSession } of [first, second]) {
      await project.refresh()
      await order.refresh()
      await address.refresh()
      await checkoutSession.refresh()
      assert.equal(project.customerId, customer.id)
      assert.equal(order.customerId, customer.id)
      assert.equal(address.customerId, customer.id)
      assert.equal(checkoutSession.customerId, customer.id)
    }
    assert.isNull(await Customer.find(guest.id))

    await customer.refresh()
    assert.isTrue(customer.marketingOptIn)

    // The guest is gone, so the same link can't be used twice.
    const again = await client
      .post(signedClaimPath(guest, user))
      .withSession(signupResponse.session())
    again.assertStatus(404)
  })

  test('a claim link only works for the account it was issued to', async ({ client, assert }) => {
    mail.fake()
    const guest = await guestCustomer('jane@example.com')
    const { project } = await projectWithOrder(guest.id)

    const janeSignup = await signup(client, 'jane@example.com')
    janeSignup.assertStatus(200)
    const { user: jane } = await accountCustomer('jane@example.com')
    const intruderSignup = await signup(client, 'intruder@example.com')
    intruderSignup.assertStatus(200)

    const response = await client
      .post(signedClaimPath(guest, jane))
      .withSession(intruderSignup.session())

    response.assertStatus(403)
    await project.refresh()
    assert.equal(project.customerId, guest.id)
  })

  test("refuses a link for a guest whose email doesn't match the account", async ({
    client,
    assert,
  }) => {
    mail.fake()
    const guest = await guestCustomer('someone-else@example.com')
    const { project } = await projectWithOrder(guest.id)

    const signupResponse = await signup(client, 'jane@example.com')
    signupResponse.assertStatus(200)
    const { user } = await accountCustomer('jane@example.com')

    const response = await client
      .post(signedClaimPath(guest, user))
      .withSession(signupResponse.session())

    response.assertStatus(403)
    await project.refresh()
    assert.equal(project.customerId, guest.id)
  })

  test('refuses a claim with a bad signature or without signing in', async ({ client, assert }) => {
    mail.fake()
    const guest = await guestCustomer('jane@example.com')
    const { project } = await projectWithOrder(guest.id)

    const signupResponse = await signup(client, 'jane@example.com')
    signupResponse.assertStatus(200)
    const { user } = await accountCustomer('jane@example.com')

    const unsigned = await client
      .post(`/v1/account/guest-claims/${guest.uuid}/${user.uuid}`)
      .withSession(signupResponse.session())
    unsigned.assertStatus(403)

    const signedOut = await client.post(signedClaimPath(guest, user))
    signedOut.assertStatus(401)

    await project.refresh()
    assert.equal(project.customerId, guest.id)
  })

  test('resending always answers 202 and emails only when there is work to claim', async ({
    client,
  }) => {
    const { mails } = mail.fake()
    const noHistory = await signup(client, 'fresh@example.com')
    noHistory.assertStatus(200)

    const resendNone = await client
      .post('/v1/account/guest-claims')
      .withSession(noHistory.session())
    resendNone.assertStatus(202)
    mails.assertNoneSent()

    const guest = await guestCustomer('fresh@example.com')
    await projectWithOrder(guest.id)

    const resend = await client.post('/v1/account/guest-claims').withSession(noHistory.session())
    resend.assertStatus(202)
    mails.assertSentCount(GuestClaimNotification, 1)
  })
})
