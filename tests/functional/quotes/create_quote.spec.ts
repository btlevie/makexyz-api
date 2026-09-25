import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Customer from '#models/customer'
import Material from '#models/material'
import PricingConfig from '#models/pricing_config'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import QuoteItem from '#models/quote_item'
import User from '#models/user'
import Vendor from '#models/vendor'
import { activeVendorAttributes } from '#tests/helpers/vendors'

const DEFAULT_VALUES = {
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
}

async function seedPricingConfig(overrides: Partial<typeof DEFAULT_VALUES> = {}) {
  const config = await PricingConfig.create({
    technology: 'fdm',
    name: 'Test FDM pricing',
    version: 1,
    isActive: true,
  })
  await config.related('fdmValues').create({ ...DEFAULT_VALUES, ...overrides })
  return config
}

async function seedCapableVendor(technology: 'fdm' | 'sla' | 'sls' = 'fdm') {
  const user = await User.create({
    uuid: string.uuid(),
    email: `v-${string.uuid()}@test.com`,
    password: 'password123',
    role: 'vendor',
  })
  const vendor = await Vendor.create({
    uuid: string.uuid(),
    userId: user.id,
    ...activeVendorAttributes(),
  })
  await vendor
    .related('technologyCapabilities')
    .create({ technology, isPreferred: false, status: 'approved' })
  return vendor
}

async function signup(client: any) {
  const email = `quote-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Quote',
    lastName: 'User',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  const customer = await Customer.findByOrFail('userId', user.id)

  return { session: response.session(), user, customer }
}

/**
 * A fully sliced part matching the specification's worked example:
 * 50g model, 10g support, 2 hours, comfortably within the size threshold.
 */
async function createSlicedProjectFile(
  customer: Customer,
  overrides: Partial<{
    modelMaterialGrams: number
    supportMaterialGrams: number
    printTimeEstimatedSeconds: number
    x: number
    y: number
    z: number
    status: 'pending' | 'processing' | 'completed' | 'failed'
  }> = {}
) {
  const material = await Material.firstOrCreate(
    { name: 'PLA' },
    { uuid: string.uuid(), technology: 'fdm', isDefault: true, trueCostPerGram: '0.02' }
  )
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer.id,
    status: 'draft',
  })
  const projectFile = await ProjectFile.create({
    uuid: string.uuid(),
    projectId: project.id,
    materialId: material.id,
    fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
    originalName: 'cube.stl',
    mimeType: 'model/stl',
    fileSize: 1024,
    status: overrides.status ?? 'completed',
    modelMaterialGrams: overrides.modelMaterialGrams ?? 50,
    supportMaterialGrams: overrides.supportMaterialGrams ?? 10,
    printTimeEstimatedSeconds: overrides.printTimeEstimatedSeconds ?? 7200,
    // millimeters
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    z: overrides.z ?? 100,
  })

  return { project, projectFile, material }
}

test.group('Quotes | create', (group) => {
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

  test('requires authentication', async ({ client }) => {
    const response = await client
      .post(`/v1/projects/${string.uuid()}/quotes`)
      .json({ items: [{ projectFileUuid: string.uuid(), quantity: 1 }] })

    response.assertStatus(401)
  })

  test('prices a single part at the specification worked example', async ({ client, assert }) => {
    await seedPricingConfig()
    await seedCapableVendor('fdm')
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer)

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 1 }] })

    response.assertStatus(200)
    response.assertBodyContains({
      data: {
        status: 'draft',
        revision: 1,
        generatedBy: 'system',
        items: [{ itemType: 'printing', quantity: 1 }],
      },
    })

    const quote = await Quote.findByOrFail('projectId', project.id)
    assert.equal(Number(quote.subtotal), 23.45)
    assert.equal(Number(quote.tax), 0)
    assert.equal(Number(quote.total), 23.45)

    const quoteItems = await QuoteItem.query().where('quoteId', quote.id)
    assert.lengthOf(quoteItems, 1)
    assert.equal(Number(quoteItems[0].total), 23.45)
    assert.equal(Number(quoteItems[0].unitPrice), 23.45)
    assert.equal(quoteItems[0].projectFileId, projectFile.id)
  })

  test('stores the pricing configuration and full calculation snapshot', async ({
    client,
    assert,
  }) => {
    const config = await seedPricingConfig()
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer)

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 1 }] })

    response.assertStatus(200)

    const quoteItem = await QuoteItem.query().firstOrFail()
    assert.equal(quoteItem.pricingConfigId, config.id)

    const snapshot = quoteItem.pricingSnapshot
    assert.equal(snapshot.quantity, 1)
    assert.equal(snapshot.pricingConfiguration.id, config.id)
    assert.equal(snapshot.pricingConfiguration.version, 1)
    assert.equal(snapshot.slicerInputs.modelGrams, 50)
    assert.equal(snapshot.slicerInputs.supportGrams, 10)
    assert.equal(snapshot.slicerInputs.printHours, 2)
    assert.equal(snapshot.slicerInputs.trueFilamentCostPerGram, 0.02)
    assert.deepEqual(snapshot.slicerInputs.dimensionsMm, { x: 100, y: 100, z: 100 })
    assert.closeTo(snapshot.calculation.variablePrice, 15.95, 1e-9)
    assert.isFalse(snapshot.calculation.isOversize)
    assert.equal(snapshot.calculation.finalPriceRounded, 23.45)
    // Bulk fields stay null for a single part.
    assert.isNull(snapshot.calculation.bulkUnitPrice)
  })

  test('prices a bulk line with one fixed charge for the whole line', async ({
    client,
    assert,
  }) => {
    await seedPricingConfig()
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer)

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 10 }] })

    response.assertStatus(200)

    const pVar = 1.1 * (50 * 0.15 + 10 * 0.3 + 2 * 2.0)
    // Floor basis is total extruded filament: model + support.
    const totalGrams = 50 + 10
    const floorMultiplier = 3.25 + (10 - 3.25) / (1 + Math.exp((totalGrams - 75) / 15))
    const pFloor = totalGrams * 0.02 * floorMultiplier
    const pUnit = pFloor + (pVar - pFloor) * Math.exp(-(10 - 1) / 18)
    const expectedTotal = Math.round((10 * pUnit + 7.5 + Number.EPSILON) * 100) / 100

    const quoteItem = await QuoteItem.query().firstOrFail()
    assert.equal(quoteItem.quantity, 10)
    assert.equal(Number(quoteItem.total), expectedTotal)

    const snapshot = quoteItem.pricingSnapshot
    assert.closeTo(snapshot.calculation.bulkUnitPrice, pUnit, 1e-9)
    assert.closeTo(
      snapshot.calculation.linePriceBeforeOversize - snapshot.calculation.partsPrice,
      7.5,
      1e-9
    )
  })

  test('applies the oversize surcharge above the threshold', async ({ client, assert }) => {
    await seedPricingConfig()
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer, { x: 325.01 })

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 1 }] })

    response.assertStatus(200)

    const quoteItem = await QuoteItem.query().firstOrFail()
    assert.equal(Number(quoteItem.total), 30.49)
    assert.isTrue(quoteItem.pricingSnapshot.calculation.isOversize)
  })

  test('treats a part measuring exactly the threshold as normal size', async ({
    client,
    assert,
  }) => {
    await seedPricingConfig()
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer, { x: 325 })

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 1 }] })

    response.assertStatus(200)

    const quoteItem = await QuoteItem.query().firstOrFail()
    assert.equal(Number(quoteItem.total), 23.45)
    assert.isFalse(quoteItem.pricingSnapshot.calculation.isOversize)
  })

  test('sums multiple line items into the quote subtotal', async ({ client, assert }) => {
    await seedPricingConfig()
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer)

    const secondFile = await ProjectFile.create({
      uuid: string.uuid(),
      projectId: project.id,
      materialId: projectFile.materialId,
      fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
      originalName: 'bracket.stl',
      mimeType: 'model/stl',
      fileSize: 2048,
      status: 'completed',
      modelMaterialGrams: 20,
      supportMaterialGrams: 0,
      printTimeEstimatedSeconds: 3600,
      x: 50,
      y: 50,
      z: 50,
    })

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({
        items: [
          { projectFileUuid: projectFile.uuid, quantity: 1 },
          { projectFileUuid: secondFile.uuid, quantity: 1 },
        ],
      })

    response.assertStatus(200)

    const quoteItems = await QuoteItem.query().orderBy('id')
    assert.lengthOf(quoteItems, 2)

    // Second part: 1.10 * (20*0.15 + 0 + 1*2.00) + 7.50 = 13.00
    assert.equal(Number(quoteItems[1].total), 13.0)

    const quote = await Quote.query().firstOrFail()
    assert.equal(Number(quote.subtotal), 36.45)
    assert.equal(Number(quote.total), 36.45)
  })

  test('increments the revision for each new quote on a project', async ({ client, assert }) => {
    await seedPricingConfig()
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer)

    const payload = { items: [{ projectFileUuid: projectFile.uuid, quantity: 1 }] }

    const first = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json(payload)
    const second = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json(payload)

    first.assertStatus(200)
    second.assertStatus(200)

    const quotes = await Quote.query().orderBy('revision')
    assert.lengthOf(quotes, 2)
    assert.equal(quotes[0].revision, 1)
    assert.equal(quotes[1].revision, 2)
  })

  test('refuses to price a project file that has not finished slicing', async ({
    client,
    assert,
  }) => {
    await seedPricingConfig()
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer, { status: 'pending' })

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 1 }] })

    response.assertStatus(422)
    assert.lengthOf(await Quote.all(), 0)
  })

  test('refuses to price when the material has no true cost', async ({ client, assert }) => {
    await seedPricingConfig()
    const { session, customer } = await signup(client)
    const { project, projectFile, material } = await createSlicedProjectFile(customer)

    material.trueCostPerGram = null
    await material.save()

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 1 }] })

    response.assertStatus(422)
    assert.lengthOf(await Quote.all(), 0)
  })

  test('returns 503 rather than quoting when no pricing configuration is active', async ({
    client,
    assert,
  }) => {
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer)

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 1 }] })

    response.assertStatus(503)
    assert.lengthOf(await Quote.all(), 0)
  })

  test('rejects an invalid quantity', async ({ client }) => {
    await seedPricingConfig()
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer)

    const zero = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 0 }] })
    zero.assertStatus(422)

    const fractional = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 2.5 }] })
    fractional.assertStatus(422)
  })

  test('does not quote another customer project', async ({ client, assert }) => {
    await seedPricingConfig()
    const owner = await signup(client)
    const intruder = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(owner.customer)

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(intruder.session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 1 }] })

    response.assertStatus(404)
    assert.lengthOf(await Quote.all(), 0)
  })

  test('returns 404 for a project file belonging to another project', async ({ client }) => {
    await seedPricingConfig()
    const { session, customer } = await signup(client)
    const { project } = await createSlicedProjectFile(customer)
    const other = await createSlicedProjectFile(customer)

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: other.projectFile.uuid, quantity: 1 }] })

    response.assertStatus(404)
  })

  test('reflects an updated pricing configuration in new quotes', async ({ client, assert }) => {
    await seedPricingConfig({ modelMaterialRatePerGram: '0.17' })
    const { session, customer } = await signup(client)
    const { project, projectFile } = await createSlicedProjectFile(customer)

    const response = await client
      .post(`/v1/projects/${project.uuid}/quotes`)
      .withSession(session)
      .json({ items: [{ projectFileUuid: projectFile.uuid, quantity: 1 }] })

    response.assertStatus(200)

    // 1.10 * (50*0.17 + 10*0.30 + 2*2.00) + 7.50 = 24.55
    const quoteItem = await QuoteItem.query().firstOrFail()
    assert.equal(Number(quoteItem.total), 24.55)
  })
})
