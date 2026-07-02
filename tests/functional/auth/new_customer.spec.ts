import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Customer from '#models/customer'
import User from '#models/user'

test.group('Auth | new customer', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(() => testUtils.db().truncate())

  test('creates a user and customer record', async ({ client, assert }) => {
    const email = 'jane.doe@example.com'

    const response = await client.post('/v1/auth/new-customer').json({
      firstName: 'Jane',
      lastName: 'Doe',
      email,
      password: 'password123',
    })

    response.assertStatus(200)
    response.assertBodyContains({
      data: {
        firstName: 'Jane',
        lastName: 'Doe',
      },
    })

    const user = await User.findByOrFail('email', email)
    assert.equal(user.role, 'customer')
    assert.equal(user.fullName, 'Jane Doe')

    const customer = await Customer.findByOrFail('userId', user.id)
    assert.equal(customer.firstName, 'Jane')
    assert.equal(customer.lastName, 'Doe')
  })

  test('rejects duplicate email addresses', async ({ client }) => {
    await client.post('/v1/auth/new-customer').json({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'duplicate@example.com',
      password: 'password123',
    })

    const response = await client.post('/v1/auth/new-customer').json({
      firstName: 'John',
      lastName: 'Doe',
      email: 'duplicate@example.com',
      password: 'password456',
    })

    response.assertStatus(422)
  })
})
