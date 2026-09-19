import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import Address from '#models/address'
import Customer from '#models/customer'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import ProductionTimeConfig from '#models/production_time_config'
import Quote from '#models/quote'
import ServiceableCountry from '#models/serviceable_country'
import { issueGrant } from '#services/project_grant_service'
import { DEFAULT_ADDRESS_LABEL } from '#services/address_service'

/** Valid inline shipping-address fields, spread into a configure request body. */
const validShippingAddress = {
  shippingRecipientName: 'Jane Doe',
  shippingLine1: '123 Main St',
  shippingCity: 'Springfield',
  shippingPostalCode: '62704',
}

async function seedProductionTimeConfig() {
  const config = await ProductionTimeConfig.create({
    name: 'Test production time',
    version: 1,
    isActive: true,
    standardBusinessDays: 5,
    baseFee: '5.00',
    growthRate: '1.6',
  })
  await config.related('tiers').createMany([
    { businessDays: 5 },
    { businessDays: 3 },
    { businessDays: 2 },
    { businessDays: 1 },
  ])
  return config
}

async function seedServiceableCountry(countryCode = 'US', countryName = 'United States') {
  return ServiceableCountry.create({ countryCode, countryName, isActive: true })
}

async function createQuoteWithItem(
  printTimeEstimatedSeconds = 3600,
  options: { withCustomer?: boolean } = {}
) {
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
    printTimeEstimatedSeconds,
  })
  const quote = await Quote.create({
    uuid: string.uuid(),
    projectId: project.id,
    revision: 1,
    subtotal: '100.00',
    tax: '0.00',
    total: '100.00',
    status: 'draft',
    generatedBy: 'system',
  })
  await quote.related('items').create({
    projectFileId: projectFile.id,
    itemType: 'printing',
    description: projectFile.originalName,
    quantity: 1,
    unitPrice: '100.00',
    total: '100.00',
  })

  return { project, projectFile, quote, customer, grant: issueGrant(project) }
}

test.group('Quotes | configure', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    // instantQuoteThrottle is keyed per IP and the memory limiter store
    // persists across tests within this file - clear it too, or the small
    // test-env rate limit (INSTANT_QUOTE_RATE_LIMIT_REQUESTS=5) trips well
    // before this file's many configure/accept calls are done.
    await limiter.clear()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('sets shipping, production time, and tax and creates a new revision', async ({
    client,
    assert,
  }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'ups_2day',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })

    response.assertStatus(200)
    const data = response.body().data as Record<string, any>
    assert.equal(data.revision, 2)
    assert.equal(data.destinationCountry, 'US')
    assert.equal(data.shippingMethod, 'ups_2day')
    assert.equal(data.shippingFeeAmount, '29.00')
    assert.equal(data.productionTimeBusinessDays, 5)
    assert.equal(data.productionTimeFeeAmount, '0.00')
    // Fake tax calculator: 8% of (100 subtotal + 29 shipping + 0 production).
    assert.equal(data.tax, '10.32')
    assert.equal(data.total, '139.32')
    assert.equal(data.shippingAddress.recipientName, validShippingAddress.shippingRecipientName)
    assert.equal(data.shippingAddress.label, DEFAULT_ADDRESS_LABEL)

    const revisions = await Quote.query().where('projectId', project.id)
    assert.lengthOf(revisions, 2)

    const address = await Address.findOrFail(
      (await Quote.findByOrFail('uuid', data.uuid)).addressId!
    )
    // createQuoteWithItem already attaches a customer to the project, so the
    // address created during configure is owned immediately (see the
    // "creates an unowned address for a fully anonymous project" test below
    // for the customerId: null case).
    assert.equal(address.customerId, project.customerId)
  })

  test('charges a production-time fee for a faster turnaround', async ({ client, assert }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 1,
        ...validShippingAddress,
      })

    response.assertStatus(200)
    const data = response.body().data as Record<string, any>
    // fee(daysSaved=4) = 5 * (1.6^4 - 1) = 27.768 -> rounded 27.77
    assert.equal(data.productionTimeFeeAmount, '27.77')
  })

  test('creates an unowned address for a fully anonymous project', async ({ client, assert }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem(3600, { withCustomer: false })

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })

    response.assertStatus(200)
    const data = response.body().data as Record<string, any>
    const address = await Address.findOrFail(
      (await Quote.findByOrFail('uuid', data.uuid)).addressId!
    )
    assert.isNull(address.customerId)
  })

  test('reuses an existing saved address via addressUuid', async ({ client, assert }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant, customer } = await createQuoteWithItem()
    const saved = await Address.create({
      uuid: string.uuid(),
      ownerType: 'customer',
      customerId: customer!.id,
      recipientName: 'Saved Person',
      line1: '1 Saved Way',
      city: 'Saved City',
      postalCode: '00000',
      country: 'US',
    })

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 5,
        addressUuid: saved.uuid,
      })

    response.assertStatus(200)
    const data = response.body().data as Record<string, any>
    assert.equal(data.shippingAddress.recipientName, 'Saved Person')

    const configuredQuote = await Quote.findByOrFail('uuid', data.uuid)
    assert.equal(configuredQuote.addressId, saved.id)
    assert.lengthOf(await Address.query().where('customerId', customer!.id), 1)
  })

  test('refuses an addressUuid belonging to a different customer', async ({ client }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem()
    const otherCustomer = await Customer.create({ uuid: string.uuid() })
    const someoneElsesAddress = await Address.create({
      uuid: string.uuid(),
      ownerType: 'customer',
      customerId: otherCustomer.id,
      recipientName: 'Someone Else',
      line1: '1 Elsewhere Way',
      city: 'Elsewhere',
      postalCode: '00000',
      country: 'US',
    })

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 5,
        addressUuid: someoneElsesAddress.uuid,
      })

    response.assertStatus(422)
  })

  test('rejects a country that is not serviceable', async ({ client }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'ZZ',
        shippingMethod: 'free',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })

    response.assertStatus(422)
  })

  test('rejects a domestic-only shipping method for an international destination', async ({
    client,
  }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry('GB', 'United Kingdom')
    const { project, quote, grant } = await createQuoteWithItem()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'GB',
        shippingMethod: 'ups_2day',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })

    response.assertStatus(422)
  })

  test('rejects a production time the part cannot physically finish in', async ({ client }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    // 1 business day = 86400s available; this print needs far longer.
    const { project, quote, grant } = await createQuoteWithItem(200_000)

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 1,
        ...validShippingAddress,
      })

    response.assertStatus(422)
  })

  test('rejects a business-day count that is not a configured tier', async ({ client }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 4,
        ...validShippingAddress,
      })

    response.assertStatus(422)
  })

  test('rejects inline address fields missing a required subfield', async ({ client }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({ destinationCountry: 'US', shippingMethod: 'free', productionTimeBusinessDays: 5 })

    response.assertStatus(422)
  })

  test('refuses to configure a superseded (non-latest) revision', async ({ client }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem()

    // First configure moves the project to revision 2.
    await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })

    // Re-configuring the original (now stale) revision must fail.
    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'ups_2day',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })

    response.assertStatus(409)
  })

  test('refuses to configure an already-accepted quote', async ({ client }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem()
    quote.status = 'accepted'
    quote.destinationCountry = 'US'
    quote.shippingMethod = 'free'
    quote.productionTimeBusinessDays = 5
    await quote.save()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'ups_2day',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })

    response.assertStatus(409)
  })

  test('creates a second, independent address on a second configure call', async ({
    client,
    assert,
  }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem()

    const first = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })
    const firstUuid = (first.body().data as { uuid: string }).uuid

    const second = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${firstUuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 5,
        shippingRecipientName: 'John Smith',
        shippingLine1: '456 Oak Ave',
        shippingCity: 'Shelbyville',
        shippingPostalCode: '62565',
      })
    const secondUuid = (second.body().data as { uuid: string }).uuid

    const firstQuote = await Quote.findByOrFail('uuid', firstUuid)
    const secondQuote = await Quote.findByOrFail('uuid', secondUuid)
    assert.notEqual(firstQuote.addressId, secondQuote.addressId)

    const firstAddress = await Address.findOrFail(firstQuote.addressId!)
    const secondAddress = await Address.findOrFail(secondQuote.addressId!)
    assert.equal(firstAddress.recipientName, validShippingAddress.shippingRecipientName)
    assert.equal(secondAddress.recipientName, 'John Smith')
  })

  test('returns 404 without the right grant', async ({ client }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote } = await createQuoteWithItem()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })

    response.assertStatus(404)
  })
})

test.group('Quotes | accept', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    // instantQuoteThrottle is keyed per IP and the memory limiter store
    // persists across tests within this file - clear it too, or the small
    // test-env rate limit (INSTANT_QUOTE_RATE_LIMIT_REQUESTS=5) trips well
    // before this file's many configure/accept calls are done.
    await limiter.clear()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('accepts a fully-configured quote', async ({ client, assert }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createQuoteWithItem()

    const configureResponse = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })
    const configuredUuid = (configureResponse.body().data as { uuid: string }).uuid

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${configuredUuid}/accept`)
      .header('x-project-grant', grant)

    response.assertStatus(200)
    const data = response.body().data as Record<string, any>
    assert.equal(data.status, 'accepted')
    assert.equal(data.shippingAddress.recipientName, validShippingAddress.shippingRecipientName)
  })

  test('refuses to accept an unconfigured quote', async ({ client }) => {
    const { project, quote, grant } = await createQuoteWithItem()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/accept`)
      .header('x-project-grant', grant)

    response.assertStatus(422)
  })

  test('refuses to accept a quote missing only the shipping address', async ({ client }) => {
    const { project, quote, grant } = await createQuoteWithItem()
    quote.destinationCountry = 'US'
    quote.shippingMethod = 'free'
    quote.productionTimeBusinessDays = 5
    await quote.save()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/accept`)
      .header('x-project-grant', grant)

    response.assertStatus(422)
  })

  test('accepting an already-accepted quote is idempotent', async ({ client, assert }) => {
    const { project, quote, grant } = await createQuoteWithItem()
    quote.destinationCountry = 'US'
    quote.shippingMethod = 'free'
    quote.productionTimeBusinessDays = 5
    quote.status = 'accepted'
    await quote.save()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/accept`)
      .header('x-project-grant', grant)

    response.assertStatus(200)
    assert.equal((response.body().data as { status: string }).status, 'accepted')
  })

  test('refuses to accept a rejected quote', async ({ client }) => {
    const { project, quote, grant } = await createQuoteWithItem()
    quote.status = 'rejected'
    await quote.save()

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/accept`)
      .header('x-project-grant', grant)

    response.assertStatus(409)
  })

  test('refuses to accept a superseded (non-latest) revision, even if configured', async ({
    client,
  }) => {
    const { project, quote, grant, customer } = await createQuoteWithItem()
    // Configured directly (not via the endpoint) so this revision is valid to
    // accept on its own terms - the only thing wrong with it is that it's no
    // longer the latest.
    const address = await Address.create({
      uuid: string.uuid(),
      ownerType: 'customer',
      customerId: customer!.id,
      recipientName: 'Jane Doe',
      line1: '123 Main St',
      city: 'Springfield',
      postalCode: '62704',
      country: 'US',
    })
    quote.destinationCountry = 'US'
    quote.shippingMethod = 'free'
    quote.productionTimeBusinessDays = 5
    quote.addressId = address.id
    await quote.save()
    await Quote.create({
      uuid: string.uuid(),
      projectId: project.id,
      // Same lineage as `quote` - a real revision 2 always points back to
      // its root via originQuoteId; without it this row would look like an
      // unrelated, independent lineage and not supersede anything.
      originQuoteId: quote.id,
      revision: 2,
      subtotal: '100.00',
      tax: '0.00',
      total: '100.00',
      status: 'draft',
      generatedBy: 'system',
    })

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/accept`)
      .header('x-project-grant', grant)

    response.assertStatus(409)
  })
})

test.group('Serviceable countries', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    // instantQuoteThrottle is keyed per IP and the memory limiter store
    // persists across tests within this file - clear it too, or the small
    // test-env rate limit (INSTANT_QUOTE_RATE_LIMIT_REQUESTS=5) trips well
    // before this file's many configure/accept calls are done.
    await limiter.clear()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('lists active serviceable countries', async ({ client, assert }) => {
    await seedServiceableCountry('US', 'United States')
    await seedServiceableCountry('GB', 'United Kingdom')
    await ServiceableCountry.create({ countryCode: 'DE', countryName: 'Germany', isActive: false })

    const response = await client.get('/v1/serviceable-countries')

    response.assertStatus(200)
    const countries = response.body().data as { countryCode: string }[]
    assert.sameMembers(
      countries.map((c) => c.countryCode),
      ['US', 'GB']
    )
  })
})
