import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Address from '#models/address'
import Customer from '#models/customer'
import Order from '#models/order'
import Project from '#models/project'
import Quote from '#models/quote'
import User from '#models/user'

async function signup(client: any) {
  const email = `address-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Address',
    lastName: 'User',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  const customer = await Customer.findByOrFail('userId', user.id)

  return { session: response.session(), user, customer }
}

const validAddress = {
  label: 'Home',
  recipientName: 'Jane Doe',
  line1: '123 Main St',
  city: 'Springfield',
  postalCode: '62704',
  country: 'US',
}

test.group('Account | addresses', (group) => {
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

  test('creates and lists an address', async ({ client, assert }) => {
    const { session } = await signup(client)

    const createResponse = await client.post('/v1/account/addresses').withSession(session).json(validAddress)
    createResponse.assertStatus(200)
    const created = createResponse.body().data as Record<string, any>
    assert.equal(created.recipientName, 'Jane Doe')
    assert.isFalse(created.isDefault)

    const listResponse = await client.get('/v1/account/addresses').withSession(session)
    listResponse.assertStatus(200)
    assert.lengthOf(listResponse.body().data as Record<string, any>[], 1)
  })

  test('shows, updates, and deletes an address', async ({ client, assert }) => {
    const { session } = await signup(client)
    const createResponse = await client.post('/v1/account/addresses').withSession(session).json(validAddress)
    const uuid = (createResponse.body().data as { uuid: string }).uuid

    const showResponse = await client.get(`/v1/account/addresses/${uuid}`).withSession(session)
    showResponse.assertStatus(200)

    const updateResponse = await client
      .patch(`/v1/account/addresses/${uuid}`)
      .withSession(session)
      .json({ city: 'Shelbyville' })
    updateResponse.assertStatus(200)
    assert.equal(((updateResponse.body() as any).data as { city: string }).city, 'Shelbyville')

    const deleteResponse = await client.delete(`/v1/account/addresses/${uuid}`).withSession(session)
    deleteResponse.assertStatus(204)

    const showAfterDelete = await client.get(`/v1/account/addresses/${uuid}`).withSession(session)
    showAfterDelete.assertStatus(404)
  })

  test('setting isDefault unsets the previous default', async ({ client, assert }) => {
    const { session, customer } = await signup(client)
    const first = await client
      .post('/v1/account/addresses')
      .withSession(session)
      .json({ ...validAddress, isDefault: true })
    const firstUuid = (first.body().data as { uuid: string }).uuid

    const second = await client
      .post('/v1/account/addresses')
      .withSession(session)
      .json({ ...validAddress, label: 'Work', isDefault: true })
    second.assertStatus(200)

    const firstAddress = await Address.findByOrFail('uuid', firstUuid)
    // isNotOk, not isFalse: SQLite (test env) has no native boolean type, so
    // a value re-fetched from the DB (unlike one returned straight from
    // .create()) comes back as 0/1, not a real JS boolean - Postgres (prod)
    // doesn't have this quirk.
    assert.isNotOk(firstAddress.isDefault)
    const defaults = await Address.query()
      .where('customerId', customer.id)
      .where('isDefault', true)
    assert.lengthOf(defaults, 1)
  })

  test("can't read, update, or delete another customer's address", async ({ client }) => {
    const owner = await signup(client)
    const intruder = await signup(client)
    const created = await client.post('/v1/account/addresses').withSession(owner.session).json(validAddress)
    const uuid = (created.body().data as { uuid: string }).uuid

    const showResponse = await client.get(`/v1/account/addresses/${uuid}`).withSession(intruder.session)
    showResponse.assertStatus(404)

    const updateResponse = await client
      .patch(`/v1/account/addresses/${uuid}`)
      .withSession(intruder.session)
      .json({ city: 'Nowhere' })
    updateResponse.assertStatus(404)

    const deleteResponse = await client
      .delete(`/v1/account/addresses/${uuid}`)
      .withSession(intruder.session)
    deleteResponse.assertStatus(404)
  })

  test('refuses to delete an address referenced by an existing quote', async ({
    client,
    assert,
  }) => {
    const { session, customer } = await signup(client)
    const created = await client.post('/v1/account/addresses').withSession(session).json(validAddress)
    const uuid = (created.body().data as { uuid: string }).uuid
    const address = await Address.findByOrFail('uuid', uuid)

    const project = await Project.create({ uuid: string.uuid(), customerId: customer.id, status: 'draft' })
    await Quote.create({
      uuid: string.uuid(),
      projectId: project.id,
      revision: 1,
      subtotal: '0.00',
      tax: '0.00',
      total: '0.00',
      status: 'draft',
      generatedBy: 'system',
      addressId: address.id,
    })

    const deleteResponse = await client.delete(`/v1/account/addresses/${uuid}`).withSession(session)
    deleteResponse.assertStatus(409)

    assert.isNotNull(await Address.find(address.id))
  })

  test("refuses to change the location of an address a paid order ships to, but allows relabeling", async ({
    client,
    assert,
  }) => {
    const { session, customer } = await signup(client)
    const created = await client.post('/v1/account/addresses').withSession(session).json(validAddress)
    const uuid = (created.body().data as { uuid: string }).uuid
    const address = await Address.findByOrFail('uuid', uuid)

    const project = await Project.create({ uuid: string.uuid(), customerId: customer.id, status: 'draft' })
    await Order.create({
      uuid: string.uuid(),
      customerId: customer.id,
      projectId: project.id,
      addressId: address.id,
      orderNumber: 'ORD-ADDR01',
      subtotal: '100.00',
      tax: '0.00',
      total: '100.00',
      status: 'open',
    })

    const moveResponse = await client
      .patch(`/v1/account/addresses/${uuid}`)
      .withSession(session)
      .json({ line1: '742 Evergreen Terrace' })
    moveResponse.assertStatus(409)
    await address.refresh()
    assert.equal(address.line1, '123 Main St')

    // Resubmitting the unchanged value isn't a change.
    const sameResponse = await client
      .patch(`/v1/account/addresses/${uuid}`)
      .withSession(session)
      .json({ line1: '123 Main St', label: 'Office', isDefault: true })
    sameResponse.assertStatus(200)
    const updated = (sameResponse.body() as any).data as { label: string; isDefault: boolean }
    assert.equal(updated.label, 'Office')
    assert.isTrue(updated.isDefault)
  })

  test('unauthenticated requests are refused', async ({ client }) => {
    const response = await client.get('/v1/account/addresses')
    response.assertStatus(401)
  })
})
