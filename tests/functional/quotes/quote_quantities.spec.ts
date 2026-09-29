import { createHmac } from 'node:crypto'
import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import Material from '#models/material'
import PricingConfig from '#models/pricing_config'
import ProductionTimeConfig from '#models/production_time_config'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import QuoteItem from '#models/quote_item'
import ServiceableCountry from '#models/serviceable_country'
import User from '#models/user'
import Vendor from '#models/vendor'
import { issueGrant } from '#services/project_grant_service'
import { activeVendorAttributes } from '#tests/helpers/vendors'
import env from '#start/env'

function sign(payload: Record<string, unknown>) {
  return createHmac('sha256', env.get('SLICER_CALLBACK_SECRET'))
    .update(JSON.stringify(payload))
    .digest('hex')
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

async function seedCapableVendor() {
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
    .create({ technology: 'fdm', isPreferred: false, status: 'approved' })
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
  await config.related('tiers').createMany([{ businessDays: 5 }, { businessDays: 1 }])
}

async function reportCompleted(client: any, projectFile: ProjectFile) {
  const payload = {
    status: 'completed' as const,
    gcodeStorageKey: `projects/foo/${projectFile.uuid}.gcode`,
    volume: 12.5,
    x: 100,
    y: 100,
    z: 100,
    infill: 15,
    layerHeight: 0.2,
    supportMaterialGrams: 10,
    modelMaterialGrams: 50,
    printTimeEstimatedSeconds: 7200,
  }

  const response = await client
    .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
    .header('x-slicer-signature', sign(payload))
    .json(payload)
  response.assertStatus(200)
}

async function createPendingFile(project: Project, name: string) {
  const material = await Material.firstOrCreate(
    { name: 'PLA' },
    { uuid: string.uuid(), technology: 'fdm', isDefault: true, trueCostPerGram: '0.02' }
  )
  return ProjectFile.create({
    uuid: string.uuid(),
    projectId: project.id,
    materialId: material.id,
    technology: 'fdm',
    fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
    originalName: name,
    mimeType: 'model/stl',
    fileSize: 1024,
    status: 'pending',
  })
}

/**
 * An anonymous instant-quote project with two sliced parts, auto-quoted the
 * real way (slicer callback) at quantity 1 each - 23.45 per part.
 */
async function autoQuotedProject(client: any) {
  await seedPricingConfig()
  await seedCapableVendor()
  const project = await Project.create({ uuid: string.uuid(), customerId: null, status: 'draft' })
  const files = [
    await createPendingFile(project, 'part-0.stl'),
    await createPendingFile(project, 'part-1.stl'),
  ]
  for (const file of files) {
    await reportCompleted(client, file)
  }
  const quote = await Quote.query().where('projectId', project.id).firstOrFail()
  return { project, files, quote, grant: issueGrant(project) }
}

function updateQuantities(
  client: any,
  project: Project,
  quote: Quote,
  grant: string | null,
  items: { projectFileUuid: string; quantity: unknown }[]
) {
  const request = client.patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/quantities`)
  if (grant) {
    request.header('x-project-grant', grant)
  }
  return request.json({ items })
}

test.group('Quotes | update quantities', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    // instantQuoteThrottle's memory store persists across tests - see
    // quote_configuration.spec.ts.
    await limiter.clear()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('reprices the changed line in a new revision of the same lineage', async ({
    client,
    assert,
  }) => {
    const { project, files, quote, grant } = await autoQuotedProject(client)
    const original = await QuoteItem.query().where('quoteId', quote.id).orderBy('id')

    const response = await updateQuantities(client, project, quote, grant, [
      { projectFileUuid: files[0].uuid, quantity: 4 },
    ])

    response.assertStatus(200)
    const data = response.body().data as Record<string, any>
    assert.equal(data.revision, 2)
    assert.equal(data.status, 'draft')

    const changed = data.items.find((item: any) => item.projectFileUuid === files[0].uuid)
    const untouched = data.items.find((item: any) => item.projectFileUuid === files[1].uuid)
    assert.equal(changed.quantity, 4)
    assert.isAbove(Number(changed.total), Number(original[0].total))
    assert.equal(changed.pricing.quantity, 4)
    // Not repriced - carried forward exactly.
    assert.equal(untouched.quantity, 1)
    assert.equal(untouched.total, original[1].total)
    assert.deepEqual(untouched.pricing, original[1].pricingSnapshot)

    assert.equal(
      Number(data.subtotal),
      Math.round((Number(changed.total) + Number(untouched.total)) * 100) / 100
    )
    assert.equal(data.total, data.subtotal)

    const revised = await Quote.findByOrFail('uuid', data.uuid)
    assert.equal(revised.originQuoteId, quote.id)

    // Still one quote from the customer's point of view.
    const index = await client
      .get(`/v1/projects/${project.uuid}/quotes`)
      .header('x-project-grant', grant)
    index.assertStatus(200)
    assert.lengthOf(index.body().data as unknown[], 1)
    assert.equal((index.body().data as Record<string, any>[])[0].uuid, data.uuid)
  })

  test('recomputes tax on a configured quote and keeps its selection', async ({
    client,
    assert,
  }) => {
    await seedProductionTimeConfig()
    await ServiceableCountry.create({
      countryCode: 'US',
      countryName: 'United States',
      isActive: true,
    })
    const { project, files, quote, grant } = await autoQuotedProject(client)

    const configure = await client
      .patch(`/v1/projects/${project.uuid}/quotes/${quote.uuid}/configure`)
      .header('x-project-grant', grant)
      .json({
        destinationCountry: 'US',
        shippingMethod: 'ups_2day',
        productionTimeBusinessDays: 5,
        shippingRecipientName: 'Jane Doe',
        shippingLine1: '123 Main St',
        shippingCity: 'Springfield',
        shippingPostalCode: '62704',
        email: 'guest@test.com',
      })
    configure.assertStatus(200)
    const configured = await Quote.findByOrFail('uuid', configure.body().data.uuid)

    const response = await updateQuantities(client, project, configured, grant, [
      { projectFileUuid: files[1].uuid, quantity: 3 },
    ])

    response.assertStatus(200)
    const data = response.body().data as Record<string, any>
    assert.equal(data.revision, 3)
    assert.equal(data.destinationCountry, 'US')
    assert.equal(data.shippingMethod, 'ups_2day')
    assert.equal(data.shippingFeeAmount, '29.00')
    assert.equal(data.productionTimeBusinessDays, 5)
    assert.equal(data.shippingAddress.recipientName, 'Jane Doe')
    assert.isAbove(Number(data.subtotal), Number(configured.subtotal))

    // Fake tax calculator: 8% of (subtotal + shipping + production).
    const expectedTax = Math.round((Number(data.subtotal) + 29) * 0.08 * 100) / 100
    assert.equal(Number(data.tax), expectedTax)
    assert.equal(
      Number(data.total),
      Math.round((Number(data.subtotal) + 29 + expectedTax) * 100) / 100
    )

    const revised = await Quote.findByOrFail('uuid', data.uuid)
    assert.equal(revised.addressId, configured.addressId)
    assert.equal(revised.originQuoteId, quote.id)
  })

  test('is a no-op when no quantity changes', async ({ client, assert }) => {
    const { project, files, quote, grant } = await autoQuotedProject(client)

    const response = await updateQuantities(client, project, quote, grant, [
      { projectFileUuid: files[0].uuid, quantity: 1 },
    ])

    response.assertStatus(200)
    assert.equal(response.body().data.uuid, quote.uuid)
    assert.lengthOf(await Quote.query().where('projectId', project.id), 1)
  })

  for (const quantity of [0, 10_001, 1.5]) {
    test(`rejects a quantity of ${quantity}`, async ({ client, assert }) => {
      const { project, files, quote, grant } = await autoQuotedProject(client)

      const response = await updateQuantities(client, project, quote, grant, [
        { projectFileUuid: files[0].uuid, quantity },
      ])

      response.assertStatus(422)
      assert.lengthOf(await Quote.query().where('projectId', project.id), 1)
    })
  }

  test('rejects the same file listed twice', async ({ client }) => {
    const { project, files, quote, grant } = await autoQuotedProject(client)

    const response = await updateQuantities(client, project, quote, grant, [
      { projectFileUuid: files[0].uuid, quantity: 2 },
      { projectFileUuid: files[0].uuid, quantity: 3 },
    ])

    response.assertStatus(422)
  })

  test('rejects a file that is not on the quote', async ({ client }) => {
    const { project, quote, grant } = await autoQuotedProject(client)

    const response = await updateQuantities(client, project, quote, grant, [
      { projectFileUuid: string.uuid(), quantity: 2 },
    ])

    response.assertStatus(422)
  })

  for (const status of ['accepted', 'rejected'] as const) {
    test(`refuses to change an ${status} quote`, async ({ client }) => {
      const { project, files, quote, grant } = await autoQuotedProject(client)
      quote.status = status
      await quote.save()

      const response = await updateQuantities(client, project, quote, grant, [
        { projectFileUuid: files[0].uuid, quantity: 2 },
      ])

      response.assertStatus(409)
    })
  }

  test('refuses a stale revision', async ({ client }) => {
    const { project, files, quote, grant } = await autoQuotedProject(client)

    const first = await updateQuantities(client, project, quote, grant, [
      { projectFileUuid: files[0].uuid, quantity: 2 },
    ])
    first.assertStatus(200)

    const response = await updateQuantities(client, project, quote, grant, [
      { projectFileUuid: files[0].uuid, quantity: 3 },
    ])

    response.assertStatus(409)
  })

  test('returns 404 without a grant', async ({ client }) => {
    const { project, files, quote } = await autoQuotedProject(client)

    const response = await updateQuantities(client, project, quote, null, [
      { projectFileUuid: files[0].uuid, quantity: 2 },
    ])

    response.assertStatus(404)
  })

  test("returns 404 with another project's grant", async ({ client }) => {
    const { project, files, quote } = await autoQuotedProject(client)
    const other = await Project.create({ uuid: string.uuid(), customerId: null, status: 'draft' })

    const response = await updateQuantities(client, project, quote, issueGrant(other), [
      { projectFileUuid: files[0].uuid, quantity: 2 },
    ])

    response.assertStatus(404)
  })

  test('a later requote keeps the chosen quantities and the lineage', async ({
    client,
    assert,
  }) => {
    const { project, files, quote, grant } = await autoQuotedProject(client)

    const response = await updateQuantities(client, project, quote, grant, [
      { projectFileUuid: files[0].uuid, quantity: 5 },
    ])
    response.assertStatus(200)

    // A newly added part triggers an auto-requote of the whole project.
    const added = await createPendingFile(project, 'added.stl')
    await reportCompleted(client, added)

    const latest = await Quote.query()
      .where('projectId', project.id)
      .orderBy('revision', 'desc')
      .firstOrFail()
    assert.equal(latest.revision, 3)
    assert.equal(latest.originQuoteId, quote.id)

    const items = await QuoteItem.query().where('quoteId', latest.id)
    const quantityOf = (file: ProjectFile) =>
      items.find((item) => item.projectFileId === file.id)?.quantity
    assert.equal(quantityOf(files[0]), 5)
    assert.equal(quantityOf(files[1]), 1)
    assert.equal(quantityOf(added), 1)

    const index = await client
      .get(`/v1/projects/${project.uuid}/quotes`)
      .header('x-project-grant', grant)
    assert.lengthOf(index.body().data as unknown[], 1)
  })
})
