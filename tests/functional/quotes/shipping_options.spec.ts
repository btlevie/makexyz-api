import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import ServiceableCountry from '#models/serviceable_country'

test.group('Shipping options | list', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await ServiceableCountry.createMany([
      { countryCode: 'US', countryName: 'United States', isActive: true },
      { countryCode: 'CA', countryName: 'Canada', isActive: true },
      { countryCode: 'MX', countryName: 'Mexico', isActive: false },
    ])

    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('lists domestic options with names and fees for the US', async ({ client, assert }) => {
    const response = await client.get('/v1/shipping-options').qs({ country: 'US' })

    response.assertStatus(200)
    assert.deepEqual(response.body().data, [
      { method: 'free', name: 'Free shipping', feeAmount: '0.00' },
      { method: 'ups_2day', name: 'UPS 2nd Day Air', feeAmount: '29.00' },
      { method: 'ups_overnight', name: 'UPS Next Day Air', feeAmount: '75.00' },
    ])
  })

  test('lists international options outside the US', async ({ client, assert }) => {
    const response = await client.get('/v1/shipping-options').qs({ country: 'CA' })

    response.assertStatus(200)
    assert.deepEqual(response.body().data, [
      { method: 'free', name: 'Free shipping', feeAmount: '0.00' },
      {
        method: 'international_expedited',
        name: 'International Expedited',
        feeAmount: '49.00',
      },
    ])
  })

  test('accepts a lowercase country code', async ({ client, assert }) => {
    const response = await client.get('/v1/shipping-options').qs({ country: 'us' })

    response.assertStatus(200)
    assert.lengthOf(response.body().data, 3)
  })

  test('rejects an inactive or unknown country', async ({ client }) => {
    const inactive = await client.get('/v1/shipping-options').qs({ country: 'MX' })
    inactive.assertStatus(422)
    inactive.assertBodyContains({ error: `We don't currently ship to "MX"` })

    const unknown = await client.get('/v1/shipping-options').qs({ country: 'ZZ' })
    unknown.assertStatus(422)
  })

  test('requires a country', async ({ client }) => {
    const response = await client.get('/v1/shipping-options')

    response.assertStatus(422)
  })
})
