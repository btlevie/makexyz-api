import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Order from '#models/order'
import Payment from '#models/payment'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import { issueGrant } from '#services/project_grant_service'
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
  await quote.related('items').create({
    projectFileId: projectFile.id,
    itemType: 'printing',
    description: projectFile.originalName,
    quantity: 1,
    unitPrice: '100.00',
    total: '100.00',
  })

  return { project, projectFile, quote, grant: issueGrant(project) }
}

test.group('Checkout | create session', (group) => {
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

  test('creates an active checkout session for an accepted quote', async ({ client, assert }) => {
    const { project, quote, grant } = await createAcceptedQuote()

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/checkout`)
      .header('x-project-grant', grant)
      .json({})

    response.assertStatus(200)
    const data = response.body().data as { uuid: string; status: string }
    assert.equal(data.status, 'active')

    const session = await CheckoutSession.findByOrFail('uuid', data.uuid)
    assert.equal(session.quoteId, quote.id)
  })

  test('is idempotent - returns the same session on a second call', async ({ client, assert }) => {
    const { project, quote, grant } = await createAcceptedQuote()

    const first = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/checkout`)
      .header('x-project-grant', grant)
      .json({})
    const second = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/checkout`)
      .header('x-project-grant', grant)
      .json({})

    assert.equal(
      (first.body().data as { uuid: string }).uuid,
      (second.body().data as { uuid: string }).uuid
    )
    const sessions = await CheckoutSession.query().where('quoteId', quote.id)
    assert.lengthOf(sessions, 1)
  })

  test('refuses to check out a quote that has not been accepted', async ({ client }) => {
    const { project, quote, grant } = await createAcceptedQuote()
    quote.status = 'draft'
    await quote.save()

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/checkout`)
      .header('x-project-grant', grant)
      .json({})

    response.assertStatus(422)
  })

  test('requires an email for a guest project with no customer attached', async ({ client }) => {
    const { project, quote, grant } = await createAcceptedQuote({ withCustomer: false })

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/checkout`)
      .header('x-project-grant', grant)
      .json({})

    response.assertStatus(422)
  })

  test('attaches a customer from email for a guest project', async ({ client, assert }) => {
    const { project, quote, grant } = await createAcceptedQuote({ withCustomer: false })

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/checkout`)
      .header('x-project-grant', grant)
      .json({ email: 'guest@example.com' })

    response.assertStatus(200)
    await project.refresh()
    assert.isNotNull(project.customerId)
    const customer = await Customer.findOrFail(project.customerId!)
    assert.equal(customer.email, 'guest@example.com')
  })

  test('returns 404 without the right grant', async ({ client }) => {
    const { project, quote } = await createAcceptedQuote()

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/checkout`)
      .json({})

    response.assertStatus(404)
  })
})

test.group('Checkout | authorize', (group) => {
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

  async function createSession(client: any) {
    const { project, quote, grant } = await createAcceptedQuote()
    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/checkout`)
      .header('x-project-grant', grant)
      .json({})
    const sessionUuid = (response.body().data as { uuid: string }).uuid
    return { project, quote, grant, sessionUuid }
  }

  test('authorizes payment and creates an order, leaving the session active', async ({
    client,
    assert,
  }) => {
    const { project, quote, grant, sessionUuid } = await createSession(client)

    const response = await client
      .patch(`/v1/projects/${project.uuid}/checkout-sessions/${sessionUuid}/authorize`)
      .header('x-project-grant', grant)
      .json({ provider: 'stripe' })

    response.assertStatus(200)
    const order = response.body().data as Record<string, any>
    assert.equal(order.status, 'open')
    assert.equal(order.total, quote.total)
    assert.lengthOf(order.items, 1)

    const session = await CheckoutSession.findByOrFail('uuid', sessionUuid)
    assert.equal(session.status, 'active')

    const payment = await Payment.query().where('checkoutSessionId', session.id).firstOrFail()
    assert.equal(payment.status, 'authorized')
    assert.equal(payment.amount, quote.total)

    const createdOrder = await Order.findByOrFail('quoteId', quote.id)
    assert.equal(createdOrder.shippingMethod, quote.shippingMethod)
    assert.equal(createdOrder.productionTimeBusinessDays, quote.productionTimeBusinessDays)
  })

  test('is idempotent - a second authorize call returns the same order, not a new one', async ({
    client,
    assert,
  }) => {
    const { project, quote, grant, sessionUuid } = await createSession(client)

    const first = await client
      .patch(`/v1/projects/${project.uuid}/checkout-sessions/${sessionUuid}/authorize`)
      .header('x-project-grant', grant)
      .json({ provider: 'stripe' })
    const second = await client
      .patch(`/v1/projects/${project.uuid}/checkout-sessions/${sessionUuid}/authorize`)
      .header('x-project-grant', grant)
      .json({ provider: 'stripe' })

    assert.equal(
      (first.body().data as { uuid: string }).uuid,
      (second.body().data as { uuid: string }).uuid
    )
    const orders = await Order.query().where('quoteId', quote.id)
    assert.lengthOf(orders, 1)
    const payments = await Payment.query()
    assert.lengthOf(payments, 1)
  })

  test('returns 404 for an unknown checkout session', async ({ client }) => {
    const { project, grant } = await createAcceptedQuote()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/checkout-sessions/${string.uuid()}/authorize`)
      .header('x-project-grant', grant)
      .json({ provider: 'stripe' })

    response.assertStatus(404)
  })
})
