import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import Address from '#models/address'
import Customer from '#models/customer'
import Order from '#models/order'
import PricingConfig from '#models/pricing_config'
import ProductionTimeConfig from '#models/production_time_config'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import ServiceableCountry from '#models/serviceable_country'
import User from '#models/user'
import Vendor from '#models/vendor'
import type { FdmPricingResult } from '#services/fdm_pricing_calculator'
import { issueGrant } from '#services/project_grant_service'
import { persistQuote } from '#services/quote_generation_service'
import { autoQuoteProjectIfReady } from '#services/auto_quote_service'
import ExpireAbandonedProjects from '#jobs/expire_abandoned_projects'

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

async function seedPricingConfig() {
  const config = await PricingConfig.create({
    technology: 'fdm',
    name: 'Test FDM pricing',
    version: 1,
    isActive: true,
  })
  await config.related('fdmValues').create({
    modelMaterialRatePerGram: '0.15',
    supportMaterialRatePerGram: '0.30',
    machineRatePerHour: '2.00',
    failureBufferMultiplier: '1.10',
    fixedLineItemCharge: '7.50',
    bulkFloorSmallMultiplier: '10.00',
    bulkFloorLargeMultiplier: '3.25',
    bulkFloorBreakGrams: '75.00',
    bulkFloorSigmoidWidthGrams: '15.00',
    quantityDecayConstant: '18.00',
    oversizeThresholdMm: '325.00',
    oversizeMultiplier: '1.30',
  })
  return config
}

/**
 * A pricing calculator only exists for FDM today (see quote_generation_service.ts
 * priceLine), so a synthetic multi-technology quote needs a hand-built result
 * instead of running SLA/SLS through the real calculator - this just needs to
 * look like whatever persistQuote reads off an FdmPricingResult.
 */
function fakePricingResult(config: PricingConfig, finalPrice: number): FdmPricingResult {
  return {
    quantity: 1,
    slicerInputs: {
      modelGrams: 10,
      supportGrams: 0,
      supportBaseGrams: null,
      supportInterfaceGrams: null,
      otherProcessGrams: null,
      totalFilamentGrams: null,
      printHours: 1,
      trueFilamentCostPerGram: 0.02,
      dimensionsMm: { x: 10, y: 10, z: 10 },
    },
    pricingConfiguration: { id: config.id, version: config.version },
    calculation: {
      modelCharge: finalPrice,
      supportCharge: 0,
      machineCharge: 0,
      preBufferVariablePrice: finalPrice,
      failureBufferMultiplier: 1,
      variablePrice: finalPrice,
      trueModelMaterialCost: null,
      bulkFloorMultiplier: null,
      bulkFloorPrice: null,
      quantityDecayFactor: null,
      bulkUnitPrice: null,
      bulkFloorExceedsVariablePrice: null,
      partsPrice: finalPrice,
      fixedLineItemCharge: 0,
      linePriceBeforeOversize: finalPrice,
      maxDimensionMm: 10,
      isOversize: false,
      oversizeMultiplier: 1,
      finalPrice,
      finalPriceRounded: finalPrice,
    },
  }
}

async function createProjectFile(
  project: Project,
  technology: 'fdm' | 'sla' | 'sls',
  printTimeEstimatedSeconds = 3600
) {
  return ProjectFile.create({
    uuid: string.uuid(),
    projectId: project.id,
    technology,
    fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
    originalName: `${technology}-part.stl`,
    mimeType: 'model/stl',
    fileSize: 1024,
    status: 'completed',
    printTimeEstimatedSeconds,
  })
}

/**
 * A `needs_review` quote spanning two project files of different
 * technologies - the shape a real unfulfillable-technology-mix auto-quote
 * would leave behind. Optionally pre-configured (destination/shipping/
 * production-time/address), as if the customer configured it before an
 * admin got around to splitting it.
 */
async function createNeedsReviewQuote(
  options: {
    technologies?: ('fdm' | 'sla' | 'sls')[]
    configured?: boolean
  } = {}
) {
  const technologies = options.technologies ?? ['fdm', 'sla']
  const customer = await Customer.create({ uuid: string.uuid() })
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer.id,
    status: 'draft',
    source: 'instant_quote',
  })

  const projectFiles: ProjectFile[] = []
  for (const technology of technologies) {
    projectFiles.push(await createProjectFile(project, technology))
  }

  let addressId: number | null = null
  if (options.configured) {
    const address = await Address.create({
      uuid: string.uuid(),
      ownerType: 'customer',
      customerId: customer.id,
      recipientName: 'Jane Doe',
      line1: '123 Main St',
      city: 'Springfield',
      postalCode: '62704',
      country: 'US',
    })
    addressId = address.id
  }

  const quote = await Quote.create({
    uuid: string.uuid(),
    projectId: project.id,
    revision: 1,
    subtotal: (projectFiles.length * 50).toFixed(2),
    tax: '0.00',
    total: (projectFiles.length * 50).toFixed(2),
    status: 'needs_review',
    reviewReason: 'unfulfillable_technology_mix',
    generatedBy: 'system',
    destinationCountry: options.configured ? 'US' : null,
    shippingMethod: options.configured ? 'free' : null,
    productionTimeBusinessDays: options.configured ? 5 : null,
    addressId,
  })

  for (const projectFile of projectFiles) {
    await quote.related('items').create({
      projectFileId: projectFile.id,
      itemType: 'printing',
      description: projectFile.originalName,
      quantity: 1,
      unitPrice: '50.00',
      total: '50.00',
    })
  }

  return { project, quote, projectFiles, customer, grant: issueGrant(project) }
}

async function grantCapability(vendor: Vendor, technology: 'fdm' | 'sla' | 'sls', isPreferred: boolean) {
  await vendor.related('technologyCapabilities').create({ technology, isPreferred })
}

async function createVendorWithCapability(technology: 'fdm' | 'sla' | 'sls', isPreferred = false) {
  const user = await User.create({
    uuid: string.uuid(),
    email: `v-${string.uuid()}@test.com`,
    password: 'password123',
    role: 'vendor',
  })
  const vendor = await Vendor.create({ uuid: string.uuid(), userId: user.id })
  await grantCapability(vendor, technology, isPreferred)
  return vendor
}

async function signupAndPromote(client: any, role: 'admin' | 'vendor' | 'customer') {
  const email = `${role}-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: role,
    lastName: 'User',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  if (role !== 'customer') {
    user.role = role
    await user.save()
  }

  return { session: response.session(), user }
}

test.group('Quote review workflow', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await limiter.clear()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('flags a technology mix no single vendor fully covers as needs_review', async ({
    assert,
  }) => {
    const config = await seedPricingConfig()
    const customer = await Customer.create({ uuid: string.uuid() })
    const project = await Project.create({ uuid: string.uuid(), customerId: customer.id, status: 'draft' })
    const fdmFile = await createProjectFile(project, 'fdm')
    const slaFile = await createProjectFile(project, 'sla')
    // A vendor covering fdm only - not the full required set.
    await createVendorWithCapability('fdm', false)

    const quote = await persistQuote(project, [
      { projectFile: fdmFile, result: fakePricingResult(config, 50) },
      { projectFile: slaFile, result: fakePricingResult(config, 50) },
    ])

    assert.equal(quote.status, 'needs_review')
    assert.equal(quote.reviewReason, 'unfulfillable_technology_mix')
  })

  test('leaves a quote fulfillable only by a non-preferred vendor as draft', async ({ assert }) => {
    const config = await seedPricingConfig()
    const customer = await Customer.create({ uuid: string.uuid() })
    const project = await Project.create({ uuid: string.uuid(), customerId: customer.id, status: 'draft' })
    const fdmFile = await createProjectFile(project, 'fdm')
    // Not preferred - hasAnyCapableVendor must not be filtering on is_preferred.
    await createVendorWithCapability('fdm', false)

    const quote = await persistQuote(project, [
      { projectFile: fdmFile, result: fakePricingResult(config, 50) },
    ])

    assert.equal(quote.status, 'draft')
    assert.isNull(quote.reviewReason)
  })

  test('configure succeeds on a needs_review quote but skips pricing', async ({
    client,
    assert,
  }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { project, quote, grant } = await createNeedsReviewQuote()

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
    assert.equal(data.status, 'needs_review')
    assert.equal(data.destinationCountry, 'US')
    assert.equal(data.shippingMethod, 'ups_2day')
    assert.isNull(data.shippingFeeAmount)
    assert.isNull(data.productionTimeFeeAmount)
    assert.equal(data.total, quote.subtotal)
    assert.equal(data.shippingAddress.recipientName, validShippingAddress.shippingRecipientName)
  })

  test('refuses to accept a needs_review quote', async ({ client }) => {
    const { project, quote, grant } = await createNeedsReviewQuote({ configured: true })

    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/accept`)
      .header('x-project-grant', grant)

    response.assertStatus(409)
  })
})

test.group('Admin quote review queue', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await limiter.clear()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('a non-admin cannot reach either admin endpoint', async ({ client }) => {
    const { session } = await signupAndPromote(client, 'customer')
    const { quote } = await createNeedsReviewQuote()

    const listResponse = await client.get('/v1/admin/quotes/needs-review').withSession(session)
    listResponse.assertStatus(403)

    const splitResponse = await client
      .post(`/v1/admin/quotes/${quote.uuid}/split`)
      .withSession(session)
      .json({ groups: [{ projectFileUuids: ['x'] }, { projectFileUuids: ['y'] }] })
    splitResponse.assertStatus(403)
  })

  test('a vendor cannot reach either admin endpoint', async ({ client }) => {
    const { session } = await signupAndPromote(client, 'vendor')

    const response = await client.get('/v1/admin/quotes/needs-review').withSession(session)

    response.assertStatus(403)
  })

  test('lists lineage-root needs_review quotes with per-item technology', async ({
    client,
    assert,
  }) => {
    const { session } = await signupAndPromote(client, 'admin')
    const { quote, projectFiles } = await createNeedsReviewQuote({
      technologies: ['fdm', 'sla'],
    })

    const response = await client.get('/v1/admin/quotes/needs-review').withSession(session)

    response.assertStatus(200)
    const data = (response.body() as any).data as any[]
    assert.lengthOf(data, 1)
    assert.equal(data[0].uuid, quote.uuid)
    assert.equal(data[0].reviewReason, 'unfulfillable_technology_mix')
    assert.sameMembers(
      data[0].items.map((item: any) => item.projectFileUuid),
      projectFiles.map((f) => f.uuid)
    )
    assert.sameMembers(
      data[0].items.map((item: any) => item.technology),
      ['fdm', 'sla']
    )
  })

  test('refuses to split a quote that is not needs_review', async ({ client }) => {
    const { session } = await signupAndPromote(client, 'admin')
    const { quote, projectFiles } = await createNeedsReviewQuote()
    quote.status = 'draft'
    quote.reviewReason = null
    await quote.save()

    const response = await client
      .post(`/v1/admin/quotes/${quote.uuid}/split`)
      .withSession(session)
      .json({
        groups: [
          { projectFileUuids: [projectFiles[0].uuid] },
          { projectFileUuids: [projectFiles[1].uuid] },
        ],
      })

    response.assertStatus(409)
  })

  test('rejects a split that leaves an item unassigned', async ({ client }) => {
    const { session } = await signupAndPromote(client, 'admin')
    const { quote, projectFiles } = await createNeedsReviewQuote()

    const response = await client
      .post(`/v1/admin/quotes/${quote.uuid}/split`)
      .withSession(session)
      .json({ groups: [{ projectFileUuids: [projectFiles[0].uuid] }, { projectFileUuids: [] }] })

    response.assertStatus(422)
  })

  test('rejects a split assigning the same item to two groups', async ({ client }) => {
    const { session } = await signupAndPromote(client, 'admin')
    const { quote, projectFiles } = await createNeedsReviewQuote()

    const response = await client
      .post(`/v1/admin/quotes/${quote.uuid}/split`)
      .withSession(session)
      .json({
        groups: [
          { projectFileUuids: [projectFiles[0].uuid, projectFiles[1].uuid] },
          { projectFileUuids: [projectFiles[1].uuid] },
        ],
      })

    response.assertStatus(422)
  })

  test('rejects a split naming a project file not on the quote', async ({ client }) => {
    const { session } = await signupAndPromote(client, 'admin')
    const { quote, projectFiles } = await createNeedsReviewQuote()

    const response = await client
      .post(`/v1/admin/quotes/${quote.uuid}/split`)
      .withSession(session)
      .json({
        groups: [
          { projectFileUuids: [projectFiles[0].uuid] },
          { projectFileUuids: [string.uuid()] },
        ],
      })

    response.assertStatus(422)
  })

  test('splits an unconfigured quote into two fulfillable draft quotes, reusing the original uuid for group 0', async ({
    client,
    assert,
  }) => {
    const { session } = await signupAndPromote(client, 'admin')
    const { quote, project, projectFiles } = await createNeedsReviewQuote({
      technologies: ['fdm', 'sla'],
    })
    await createVendorWithCapability('fdm', false)
    await createVendorWithCapability('sla', false)

    const response = await client
      .post(`/v1/admin/quotes/${quote.uuid}/split`)
      .withSession(session)
      .json({
        groups: [
          { projectFileUuids: [projectFiles[0].uuid] },
          { projectFileUuids: [projectFiles[1].uuid] },
        ],
      })

    response.assertStatus(200)
    const data = response.body().data as any[]
    assert.lengthOf(data, 2)
    assert.equal(data[0].uuid, quote.uuid)
    assert.notEqual(data[1].uuid, quote.uuid)
    for (const resultQuote of data) {
      assert.equal(resultQuote.status, 'draft')
      assert.isNull(resultQuote.reviewReason)
      assert.lengthOf(resultQuote.items, 1)
    }

    const allQuotesForProject = await Quote.query().where('projectId', project.id)
    assert.lengthOf(allQuotesForProject, 2)
    const newQuote = allQuotesForProject.find((q) => q.uuid !== quote.uuid)!
    assert.isNull(newQuote.originQuoteId)
  })

  test('splitting a configured quote carries forward config and prices each group independently', async ({
    client,
    assert,
  }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { session } = await signupAndPromote(client, 'admin')
    const { quote, projectFiles } = await createNeedsReviewQuote({
      technologies: ['fdm', 'sla'],
      configured: true,
    })
    await createVendorWithCapability('fdm', false)
    await createVendorWithCapability('sla', false)

    const response = await client
      .post(`/v1/admin/quotes/${quote.uuid}/split`)
      .withSession(session)
      .json({
        groups: [
          { projectFileUuids: [projectFiles[0].uuid] },
          { projectFileUuids: [projectFiles[1].uuid] },
        ],
      })

    response.assertStatus(200)
    const data = response.body().data as any[]
    for (const resultQuote of data) {
      assert.equal(resultQuote.status, 'draft')
      assert.equal(resultQuote.destinationCountry, 'US')
      assert.equal(resultQuote.shippingMethod, 'free')
      assert.equal(resultQuote.productionTimeBusinessDays, 5)
      // Each group's subtotal is just its own item (50.00), not a
      // proportional share of the original combined total.
      assert.equal(resultQuote.subtotal, '50.00')
      assert.isNotNull(resultQuote.shippingFeeAmount)
      assert.equal(resultQuote.shippingAddress.recipientName, 'Jane Doe')
    }
  })

  test('a group still unfulfillable after a split stays needs_review', async ({
    client,
    assert,
  }) => {
    const { session } = await signupAndPromote(client, 'admin')
    const { quote, projectFiles } = await createNeedsReviewQuote({
      technologies: ['fdm', 'sla'],
    })
    // Only fdm gets a capable vendor - the sla group stays unfulfillable.
    await createVendorWithCapability('fdm', false)

    const response = await client
      .post(`/v1/admin/quotes/${quote.uuid}/split`)
      .withSession(session)
      .json({
        groups: [
          { projectFileUuids: [projectFiles[0].uuid] },
          { projectFileUuids: [projectFiles[1].uuid] },
        ],
      })

    response.assertStatus(200)
    const data = response.body().data as any[]
    const draftQuote = data.find((q) => q.status === 'draft')
    const needsReviewQuote = data.find((q) => q.status === 'needs_review')
    assert.exists(draftQuote)
    assert.exists(needsReviewQuote)
    assert.equal(needsReviewQuote.reviewReason, 'unfulfillable_technology_mix')
    assert.isNull(needsReviewQuote.shippingFeeAmount)
  })
})

test.group('GET project quotes', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await limiter.clear()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('includes a needs_review quote', async ({ client, assert }) => {
    const { project, quote, grant } = await createNeedsReviewQuote()

    const response = await client
      .get(`/v1/projects/${project.uuid}/quotes`)
      .header('x-project-grant', grant)

    response.assertStatus(200)
    const data = response.body().data as any[]
    assert.lengthOf(data, 1)
    assert.equal(data[0].uuid, quote.uuid)
    assert.equal(data[0].status, 'needs_review')
  })

  test('lists both resulting quotes after a split, excluding rejected lineages', async ({
    client,
    assert,
  }) => {
    const adminClient = client
    const { session } = await signupAndPromote(adminClient, 'admin')
    const { project, quote, projectFiles, grant } = await createNeedsReviewQuote({
      technologies: ['fdm', 'sla'],
    })
    await createVendorWithCapability('fdm', false)
    await createVendorWithCapability('sla', false)

    const splitResponse = await client
      .post(`/v1/admin/quotes/${quote.uuid}/split`)
      .withSession(session)
      .json({
        groups: [
          { projectFileUuids: [projectFiles[0].uuid] },
          { projectFileUuids: [projectFiles[1].uuid] },
        ],
      })
    splitResponse.assertStatus(200)

    const response = await client
      .get(`/v1/projects/${project.uuid}/quotes`)
      .header('x-project-grant', grant)

    response.assertStatus(200)
    const data = response.body().data as any[]
    assert.lengthOf(data, 2)
    assert.sameMembers(
      data.map((q) => q.status),
      ['draft', 'draft']
    )
  })
})

test.group('Quote lineage scoping', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await limiter.clear()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('reconfiguring one split lineage does not affect the sibling lineage', async ({
    client,
  }) => {
    await seedProductionTimeConfig()
    await seedServiceableCountry()
    const { session } = await signupAndPromote(client, 'admin')
    const { project, quote, projectFiles, grant } = await createNeedsReviewQuote({
      technologies: ['fdm', 'sla'],
    })
    await createVendorWithCapability('fdm', false)
    await createVendorWithCapability('sla', false)

    const splitResponse = await client
      .post(`/v1/admin/quotes/${quote.uuid}/split`)
      .withSession(session)
      .json({
        groups: [
          { projectFileUuids: [projectFiles[0].uuid] },
          { projectFileUuids: [projectFiles[1].uuid] },
        ],
      })
    const [firstQuote, secondQuote] = splitResponse.body().data as { uuid: string }[]

    // Reconfigure the first lineage a second time.
    await client
      .patch(`/v1/projects/${project.uuid}/quotes/${firstQuote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'ups_2day',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })

    // The second lineage's quote (never touched) must still be configurable
    // on its own terms - it was not superseded by the first lineage's new
    // revision.
    const response = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${secondQuote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'free',
        productionTimeBusinessDays: 5,
        ...validShippingAddress,
      })

    response.assertStatus(200)
  })
})

test.group('Fallout: multi-order projects', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('GET :projectUuid/order returns every order for the project, not just the newest', async ({
    client,
    assert,
  }) => {
    const customer = await Customer.create({ uuid: string.uuid() })
    const project = await Project.create({ uuid: string.uuid(), customerId: customer.id, status: 'draft' })
    const grant = issueGrant(project)

    for (let i = 0; i < 2; i++) {
      const quote = await Quote.create({
        uuid: string.uuid(),
        projectId: project.id,
        revision: 1,
        subtotal: '100.00',
        tax: '8.00',
        total: '108.00',
        status: 'accepted',
        generatedBy: 'system',
      })
      await Order.create({
        uuid: string.uuid(),
        quoteId: quote.id,
        customerId: customer.id,
        projectId: project.id,
        orderNumber: `ORD-${string.generateRandom(6).toUpperCase()}`,
        subtotal: '100.00',
        tax: '8.00',
        total: '108.00',
        status: 'open',
      })
    }

    const response = await client
      .get(`/v1/projects/${project.uuid}/order`)
      .header('x-project-grant', grant)

    response.assertStatus(200)
    const data = response.body().data as any[]
    assert.lengthOf(data, 2)
  })

  test('returns an empty array rather than 404 when no order exists yet', async ({
    client,
    assert,
  }) => {
    const customer = await Customer.create({ uuid: string.uuid() })
    const project = await Project.create({ uuid: string.uuid(), customerId: customer.id, status: 'draft' })
    const grant = issueGrant(project)

    const response = await client
      .get(`/v1/projects/${project.uuid}/order`)
      .header('x-project-grant', grant)

    response.assertStatus(200)
    assert.lengthOf(response.body().data as any[], 0)
  })
})

test.group('Fallout: abandonment cleanup includes needs_review', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('rejects a stale needs_review quote as abandoned', async ({ assert }) => {
    const { project, quote } = await createNeedsReviewQuote()
    await Project.query()
      .where('id', project.id)
      .update({ updated_at: '2000-01-01 00:00:00' })

    await new ExpireAbandonedProjects().execute()

    await quote.refresh()
    assert.equal(quote.status, 'rejected')
    assert.equal(quote.rejectionReason, 'abandoned')
  })
})

test.group('Fallout: auto-quote guard against re-quoting a split project', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('skips auto-quoting a project that already has more than one quote lineage', async ({
    assert,
  }) => {
    await seedPricingConfig()
    const customer = await Customer.create({ uuid: string.uuid() })
    const project = await Project.create({ uuid: string.uuid(), customerId: customer.id, status: 'draft' })

    // Two independent lineages, as a split would leave behind.
    await Quote.create({
      uuid: string.uuid(),
      projectId: project.id,
      originQuoteId: null,
      revision: 1,
      subtotal: '50.00',
      tax: '0.00',
      total: '50.00',
      status: 'draft',
      generatedBy: 'system',
    })
    await Quote.create({
      uuid: string.uuid(),
      projectId: project.id,
      originQuoteId: null,
      revision: 1,
      subtotal: '50.00',
      tax: '0.00',
      total: '50.00',
      status: 'draft',
      generatedBy: 'system',
    })

    // A newly-finished file that would otherwise trigger a fresh auto-quote.
    await ProjectFile.create({
      uuid: string.uuid(),
      projectId: project.id,
      materialId: null,
      technology: 'fdm',
      fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
      originalName: 'late.stl',
      mimeType: 'model/stl',
      fileSize: 1024,
      status: 'completed',
    })

    await autoQuoteProjectIfReady(project.id)

    // No third, overlapping quote was created.
    assert.lengthOf(await Quote.query().where('projectId', project.id), 2)
  })
})
