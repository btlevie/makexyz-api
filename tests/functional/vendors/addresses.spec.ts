import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Address from '#models/address'
import User from '#models/user'
import Vendor from '#models/vendor'

async function signupVendor(client: any) {
  const email = `vendor-address-${string.uuid()}@test.com`
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

const validAddress = {
  label: 'Warehouse',
  recipientName: 'Acme Manufacturing',
  line1: '456 Industrial Way',
  city: 'Springfield',
  postalCode: '62704',
  country: 'US',
}

test.group('Vendor | addresses', (group) => {
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
    const { session } = await signupVendor(client)

    const createResponse = await client.post('/v1/vendor/addresses').withSession(session).json(validAddress)
    createResponse.assertStatus(200)
    assert.equal((createResponse.body().data as { recipientName: string }).recipientName, 'Acme Manufacturing')

    const listResponse = await client.get('/v1/vendor/addresses').withSession(session)
    listResponse.assertStatus(200)
    assert.lengthOf(listResponse.body().data as Record<string, any>[], 1)
  })

  test('shows, updates, and deletes an address', async ({ client, assert }) => {
    const { session } = await signupVendor(client)
    const createResponse = await client.post('/v1/vendor/addresses').withSession(session).json(validAddress)
    const uuid = (createResponse.body().data as { uuid: string }).uuid

    const updateResponse = await client
      .patch(`/v1/vendor/addresses/${uuid}`)
      .withSession(session)
      .json({ city: 'Shelbyville' })
    updateResponse.assertStatus(200)
    assert.equal(((updateResponse.body() as any).data as { city: string }).city, 'Shelbyville')

    const deleteResponse = await client.delete(`/v1/vendor/addresses/${uuid}`).withSession(session)
    deleteResponse.assertStatus(204)
  })

  test("can't read another vendor's address", async ({ client }) => {
    const owner = await signupVendor(client)
    const intruder = await signupVendor(client)
    const created = await client.post('/v1/vendor/addresses').withSession(owner.session).json(validAddress)
    const uuid = (created.body().data as { uuid: string }).uuid

    const response = await client.get(`/v1/vendor/addresses/${uuid}`).withSession(intruder.session)
    response.assertStatus(404)
  })

  test('a non-vendor account is forbidden', async ({ client }) => {
    const email = `customer-${string.uuid()}@test.com`
    const signupResponse = await client.post('/v1/auth/new-customer').json({
      firstName: 'Just',
      lastName: 'Customer',
      email,
      password: 'password123',
    })

    const response = await client
      .get('/v1/vendor/addresses')
      .withSession(signupResponse.session())
    response.assertStatus(403)
  })

  test('setting isDefault unsets the previous default', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    await client.post('/v1/vendor/addresses').withSession(session).json({ ...validAddress, isDefault: true })
    await client
      .post('/v1/vendor/addresses')
      .withSession(session)
      .json({ ...validAddress, label: 'Second', isDefault: true })

    const defaults = await Address.query().where('vendorId', vendor.id).where('isDefault', true)
    assert.lengthOf(defaults, 1)
  })

  test('unauthenticated requests are refused', async ({ client }) => {
    const response = await client.get('/v1/vendor/addresses')
    response.assertStatus(401)
  })
})
