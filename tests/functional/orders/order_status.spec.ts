import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import Address from '#models/address'
import Customer from '#models/customer'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import User from '#models/user'
import { issueGrant } from '#services/project_grant_service'
import { fakePaymentGateway } from '#services/payment_gateway_service'

async function createAcceptedQuote(options: { customerId?: number | null } = {}) {
  const customer =
    options.customerId === undefined ? await Customer.create({ uuid: string.uuid() }) : null
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: options.customerId === undefined ? customer!.id : options.customerId,
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
  const address = await Address.create({
    uuid: string.uuid(),
    ownerType: 'customer',
    customerId: options.customerId === undefined ? customer!.id : options.customerId,
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

  return { project, projectFile, quote, grant: issueGrant(project) }
}

async function authorizeOrder(client: any, project: Project, quote: Quote, grant: string) {
  const sessionResponse = await client
    .post(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/checkout`)
    .header('x-project-grant', grant)
    .json({})
  const sessionUuid = (sessionResponse.body().data as { uuid: string }).uuid

  await client
    .patch(`/v1/projects/${project.uuid}/checkout-sessions/${sessionUuid}/authorize`)
    .header('x-project-grant', grant)
    .json({ provider: 'stripe' })
}

async function signup(client: any) {
  const email = `order-status-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Order',
    lastName: 'Status',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  const customer = await Customer.findByOrFail('userId', user.id)

  return { session: response.session(), user, customer }
}

test.group('Orders | status', (group) => {
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

  test("returns the customer's orders, with items and shipping address", async ({
    client,
    assert,
  }) => {
    const { project, quote, grant } = await createAcceptedQuote()
    await authorizeOrder(client, project, quote, grant)

    const response = await client
      .get(`/v1/projects/${project.uuid}/order`)
      .header('x-project-grant', grant)

    response.assertStatus(200)
    const data = response.body().data as Record<string, any>[]
    assert.lengthOf(data, 1)
    assert.equal(data[0].status, 'open')
    assert.equal(data[0].total, quote.total)
    assert.lengthOf(data[0].items, 1)
    assert.equal(data[0].shippingAddress.recipientName, 'Jane Doe')
  })

  test('an authenticated customer who owns the project can also fetch it', async ({
    client,
    assert,
  }) => {
    const { session, customer } = await signup(client)
    const { project, quote, grant } = await createAcceptedQuote({ customerId: customer.id })
    await authorizeOrder(client, project, quote, grant)

    const response = await client.get(`/v1/projects/${project.uuid}/order`).withSession(session)

    response.assertStatus(200)
    const data = response.body().data as { status: string }[]
    assert.equal(data[0].status, 'open')
  })

  test('returns 404 without the right grant', async ({ client }) => {
    const { project, quote, grant } = await createAcceptedQuote()
    await authorizeOrder(client, project, quote, grant)

    const response = await client.get(`/v1/projects/${project.uuid}/order`)

    response.assertStatus(404)
  })

  test('returns an empty array when checkout never completed', async ({ client, assert }) => {
    const { project, grant } = await createAcceptedQuote()

    const response = await client
      .get(`/v1/projects/${project.uuid}/order`)
      .header('x-project-grant', grant)

    response.assertStatus(200)
    assert.lengthOf(response.body().data as any[], 0)
  })
})
