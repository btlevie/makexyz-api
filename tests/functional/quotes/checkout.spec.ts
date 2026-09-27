import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import Address from '#models/address'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Order from '#models/order'
import Payment from '#models/payment'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import { issueGrant } from '#services/project_grant_service'
import { expireCheckoutSession } from '#services/checkout_service'
import { fakePaymentGateway } from '#services/payment_gateway_service'

async function createAcceptedQuote(options: { withCustomer?: boolean } = {}) {
  const customer = options.withCustomer === false ? null : await Customer.create({ uuid: string.uuid() })
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer?.id ?? null,
    status: 'draft',
  })
  const projectFile = await ProjectFile.create({
    uuid: string.uuid(),
    projectId: project.id,
    fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
    originalName: 'cube.stl',
    mimeType: 'model/stl',
    fileSize: 1024,
    status: 'completed',
  })
  // Built directly (bypassing the real configure HTTP call) - see
  // quote_configuration.spec.ts for the endpoint's own coverage of address
  // creation/selection.
  const address = await Address.create({
    uuid: string.uuid(),
    ownerType: 'customer',
    customerId: customer?.id ?? null,
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
  await quote.related('items').create({
    projectFileId: projectFile.id,
    itemType: 'printing',
    description: projectFile.originalName,
    quantity: 1,
    unitPrice: '100.00',
    total: '100.00',
  })

  return { project, projectFile, quote, address, grant: issueGrant(project) }
}

test.group('Checkout | pay', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await limiter.clear()
    fakePaymentGateway.reset()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  function pay(client: any, project: Project, quote: Quote, grant: string, body = {}) {
    return client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/pay`)
      .header('x-project-grant', grant)
      .json({ provider: 'stripe', ...body })
  }

  test('opens a session, authorizes payment and creates the order in one call', async ({
    client,
    assert,
  }) => {
    const { project, quote, grant } = await createAcceptedQuote()

    const response = await pay(client, project, quote, grant)

    response.assertStatus(200)
    const order = response.body().data as Record<string, any>
    assert.equal(order.status, 'open')
    assert.equal(order.total, quote.total)
    assert.lengthOf(order.items, 1)

    const session = await CheckoutSession.findByOrFail('quoteId', quote.id)
    assert.equal(session.status, 'active')
    const payment = await Payment.query().where('checkoutSessionId', session.id).firstOrFail()
    assert.equal(payment.status, 'authorized')
    assert.equal(payment.amount, quote.total)
  })

  test('is idempotent - paying twice returns the same order and holds the card once', async ({
    client,
    assert,
  }) => {
    const { project, quote, grant } = await createAcceptedQuote()

    const first = await pay(client, project, quote, grant)
    const second = await pay(client, project, quote, grant)

    first.assertStatus(200)
    second.assertStatus(200)
    assert.equal(
      (first.body().data as { uuid: string }).uuid,
      (second.body().data as { uuid: string }).uuid
    )
    assert.lengthOf(await Order.query().where('quoteId', quote.id), 1)
    assert.lengthOf(await CheckoutSession.all(), 1)
    assert.lengthOf(await Payment.all(), 1)
  })

  test('never re-authorizes once the session has completed (payment captured)', async ({
    client,
    assert,
  }) => {
    const { project, quote, grant } = await createAcceptedQuote()
    const first = await pay(client, project, quote, grant)
    first.assertStatus(200)
    const session = await CheckoutSession.findByOrFail('quoteId', quote.id)
    session.status = 'completed'
    await session.save()

    const again = await pay(client, project, quote, grant)

    again.assertStatus(200)
    assert.equal(
      (again.body().data as { uuid: string }).uuid,
      (first.body().data as { uuid: string }).uuid
    )
    assert.lengthOf(await CheckoutSession.all(), 1)
    assert.lengthOf(await Payment.all(), 1)
  })

  test('refuses a quote that has not been accepted', async ({ client, assert }) => {
    const { project, quote, grant } = await createAcceptedQuote()
    quote.status = 'draft'
    await quote.save()

    const response = await pay(client, project, quote, grant)

    response.assertStatus(422)
    assert.lengthOf(await CheckoutSession.all(), 0)
    assert.lengthOf(await Order.all(), 0)
  })

  test('a declined card fails that attempt, and the next call starts a fresh one', async ({
    client,
    assert,
  }) => {
    const { project, quote, grant } = await createAcceptedQuote()
    fakePaymentGateway.declineNextAuthorize()

    const declined = await pay(client, project, quote, grant)
    declined.assertStatus(422)
    assert.lengthOf(await Order.all(), 0)
    const failed = await CheckoutSession.findByOrFail('quoteId', quote.id)
    assert.equal(failed.status, 'failed')

    const retried = await pay(client, project, quote, grant)

    retried.assertStatus(200)
    const sessions = await CheckoutSession.query().where('quoteId', quote.id).orderBy('id')
    assert.deepEqual(
      sessions.map((session) => session.status),
      ['failed', 'active']
    )
    assert.lengthOf(await Order.all(), 1)
  })

  test('requires an email only when the project still has no customer', async ({
    client,
    assert,
  }) => {
    const { project, quote, grant, address } = await createAcceptedQuote({ withCustomer: false })

    const withoutEmail = await pay(client, project, quote, grant)
    withoutEmail.assertStatus(422)
    assert.lengthOf(await CheckoutSession.all(), 0)

    const withEmail = await pay(client, project, quote, grant, { email: 'guest@example.com' })
    withEmail.assertStatus(200)
    await project.refresh()
    await address.refresh()
    const customer = await Customer.findByOrFail('email', 'guest@example.com')
    assert.equal(project.customerId, customer.id)
    assert.equal(address.customerId, customer.id)
  })

  test('a card needing 3D Secure returns the client secret, then finishes on the next call', async ({
    client,
    assert,
  }) => {
    const { project, quote, grant } = await createAcceptedQuote()
    fakePaymentGateway.requireActionOnNextAuthorize()

    const first = await pay(client, project, quote, grant)

    first.assertStatus(202)
    const action = first.body().data as { status: string; clientSecret: string }
    assert.equal(action.status, 'requires_action')
    assert.isString(action.clientSecret)
    assert.lengthOf(await Order.all(), 0)
    const pending = await Payment.firstOrFail()
    assert.equal(pending.status, 'pending')

    // Customer hasn't finished the challenge yet - still waiting.
    const stillWaiting = await pay(client, project, quote, grant)
    stillWaiting.assertStatus(202)

    fakePaymentGateway.completeAction(pending.transactionId!, 'authorized')
    const second = await pay(client, project, quote, grant)

    second.assertStatus(200)
    const order = second.body().data as Record<string, any>
    assert.equal(order.status, 'open')
    await pending.refresh()
    assert.equal(pending.status, 'authorized')
    assert.isNotNull(pending.authorizedAt)
    // Resumed, not re-authorized: one session, one payment, one transaction.
    assert.lengthOf(await CheckoutSession.all(), 1)
    assert.lengthOf(await Payment.all(), 1)
  })

  test('a failed 3D Secure challenge fails the attempt, and the next call starts fresh', async ({
    client,
    assert,
  }) => {
    const { project, quote, grant } = await createAcceptedQuote()
    fakePaymentGateway.requireActionOnNextAuthorize()
    const first = await pay(client, project, quote, grant)
    first.assertStatus(202)
    const pending = await Payment.firstOrFail()

    fakePaymentGateway.completeAction(pending.transactionId!, 'failed')
    const failedResponse = await pay(client, project, quote, grant)

    failedResponse.assertStatus(422)
    await pending.refresh()
    assert.equal(pending.status, 'failed')
    const failedSession = await CheckoutSession.findByOrFail('quoteId', quote.id)
    assert.equal(failedSession.status, 'failed')
    assert.lengthOf(await Order.all(), 0)

    const retried = await pay(client, project, quote, grant)
    retried.assertStatus(200)
    assert.lengthOf(await CheckoutSession.all(), 2)
  })

  test('expiring a session abandons a pending 3D Secure attempt', async ({ client, assert }) => {
    const { project, quote, grant } = await createAcceptedQuote()
    fakePaymentGateway.requireActionOnNextAuthorize()
    const first = await pay(client, project, quote, grant)
    first.assertStatus(202)
    const session = await CheckoutSession.findByOrFail('quoteId', quote.id)

    await expireCheckoutSession(session)

    const pending = await Payment.firstOrFail()
    assert.equal(pending.status, 'cancelled')
    await session.refresh()
    assert.equal(session.status, 'expired')
  })

  test('returns 404 without the right grant', async ({ client, assert }) => {
    const { project, quote } = await createAcceptedQuote()
    const other = await createAcceptedQuote()

    const response = await pay(client, project, quote, other.grant)

    response.assertStatus(404)
    assert.lengthOf(await Order.all(), 0)
  })
})

test.group('Checkout | PayPal order', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await limiter.clear()
    fakePaymentGateway.reset()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('creates a PayPal order for an accepted quote', async ({ client, assert }) => {
    const { project, quote, grant } = await createAcceptedQuote()

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/paypal-order`)
      .header('x-project-grant', grant)

    response.assertStatus(200)
    assert.isString((response.body().data as { orderId: string }).orderId)
  })

  test('refuses a quote that has not been accepted', async ({ client }) => {
    const { project, quote, grant } = await createAcceptedQuote()
    quote.status = 'draft'
    await quote.save()

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/paypal-order`)
      .header('x-project-grant', grant)

    response.assertStatus(422)
  })

  test('returns 404 without the right grant', async ({ client }) => {
    const { project, quote } = await createAcceptedQuote()
    const other = await createAcceptedQuote()

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/paypal-order`)
      .header('x-project-grant', other.grant)

    response.assertStatus(404)
  })
})
