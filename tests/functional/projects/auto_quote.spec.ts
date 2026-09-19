import { createHmac } from 'node:crypto'
import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Material from '#models/material'
import PricingConfig from '#models/pricing_config'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import QuoteItem from '#models/quote_item'
import User from '#models/user'
import Vendor from '#models/vendor'
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

/** An anonymous instant-quote project with `count` files still slicing. */
async function pendingProject(count = 1) {
  const material = await Material.firstOrCreate(
    { name: 'PLA' },
    { uuid: string.uuid(), technology: 'fdm', isDefault: true, trueCostPerGram: '0.02' }
  )
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: null,
    status: 'draft',
  })

  const files: ProjectFile[] = []
  for (let index = 0; index < count; index++) {
    files.push(
      await ProjectFile.create({
        uuid: string.uuid(),
        projectId: project.id,
        materialId: material.id,
        technology: 'fdm',
        fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
        originalName: `part-${index}.stl`,
        mimeType: 'model/stl',
        fileSize: 1024,
        status: 'pending',
      })
    )
  }

  return { project, files }
}

async function seedCapableVendor(technology: 'fdm' | 'sla' | 'sls' = 'fdm') {
  const user = await User.create({
    uuid: string.uuid(),
    email: `v-${string.uuid()}@test.com`,
    password: 'password123',
    role: 'vendor',
  })
  const vendor = await Vendor.create({ uuid: string.uuid(), userId: user.id })
  await vendor.related('technologyCapabilities').create({ technology, isPreferred: false })
  return vendor
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

  return client
    .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
    .header('x-slicer-signature', sign(payload))
    .json(payload)
}

async function reportFailed(client: any, projectFile: ProjectFile) {
  const payload = { status: 'failed' as const, error: 'unsupported geometry' }

  return client
    .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
    .header('x-slicer-signature', sign(payload))
    .json(payload)
}

test.group('Projects | automatic instant quoting', (group) => {
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

  test('does not quote while a file is still slicing', async ({ client, assert }) => {
    await seedPricingConfig()
    const { files } = await pendingProject(2)

    const response = await reportCompleted(client, files[0])
    response.assertStatus(200)

    // The second file hasn't reported yet, so pricing the project would be
    // pricing half of it.
    assert.lengthOf(await Quote.all(), 0)
  })

  test('quotes automatically once every file has finished', async ({ client, assert }) => {
    await seedPricingConfig()
    await seedCapableVendor('fdm')
    const { project, files } = await pendingProject(2)

    await reportCompleted(client, files[0])
    await reportCompleted(client, files[1])

    const quotes = await Quote.all()
    assert.lengthOf(quotes, 1)
    assert.equal(quotes[0].projectId, project.id)
    assert.equal(quotes[0].revision, 1)
    assert.equal(quotes[0].status, 'draft')
    assert.equal(quotes[0].generatedBy, 'system')
    // Nobody authored it - the visitor has no account.
    assert.isNull(quotes[0].createdById)

    const items = await QuoteItem.query().where('quoteId', quotes[0].id)
    assert.lengthOf(items, 2)
    // 1.10 * (50*0.15 + 10*0.30 + 2*2.00) + 7.50 = 23.45 per part at quantity 1
    assert.equal(Number(items[0].total), 23.45)
    assert.equal(items[0].quantity, 1)
    assert.equal(Number(quotes[0].subtotal), 46.9)
  })

  test('prices the successful files when one fails', async ({ client, assert }) => {
    await seedPricingConfig()
    const { files } = await pendingProject(2)

    await reportCompleted(client, files[0])
    await reportFailed(client, files[1])

    const quotes = await Quote.all()
    assert.lengthOf(quotes, 1)

    // One bad model must not cost the customer their whole price.
    const items = await QuoteItem.query().where('quoteId', quotes[0].id)
    assert.lengthOf(items, 1)
    assert.equal(items[0].projectFileId, files[0].id)
    assert.equal(Number(quotes[0].subtotal), 23.45)
  })

  test('does not quote when every file failed', async ({ client, assert }) => {
    await seedPricingConfig()
    const { files } = await pendingProject(2)

    await reportFailed(client, files[0])
    await reportFailed(client, files[1])

    assert.lengthOf(await Quote.all(), 0)
  })

  test('a later slice completion produces a new revision', async ({ client, assert }) => {
    await seedPricingConfig()
    const { project, files } = await pendingProject(1)

    await reportCompleted(client, files[0])

    // A file added afterwards - re-slicing keeps the quote in sync with the parts.
    const added = await ProjectFile.create({
      uuid: string.uuid(),
      projectId: project.id,
      materialId: files[0].materialId,
      technology: 'fdm',
      fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
      originalName: 'added.stl',
      mimeType: 'model/stl',
      fileSize: 2048,
      status: 'pending',
    })
    await reportCompleted(client, added)

    const quotes = await Quote.query().orderBy('revision')
    assert.lengthOf(quotes, 2)
    assert.equal(quotes[0].revision, 1)
    assert.equal(quotes[1].revision, 2)
    // The newest revision covers both parts.
    assert.lengthOf(await QuoteItem.query().where('quoteId', quotes[1].id), 2)
  })

  test('a redelivered callback does not duplicate the quote', async ({ client, assert }) => {
    await seedPricingConfig()
    const { files } = await pendingProject(1)

    // SQS delivers at least once; the same completion can arrive twice.
    await reportCompleted(client, files[0])
    const quotesAfterFirst = await Quote.all()

    await reportCompleted(client, files[0])
    const quotesAfterSecond = await Quote.all()

    assert.lengthOf(quotesAfterFirst, 1)
    // A redelivery re-prices rather than duplicating a revision at the same
    // number - revisions stay strictly increasing.
    assert.isAtLeast(quotesAfterSecond.length, 1)
    const revisions = quotesAfterSecond.map((quote) => quote.revision)
    assert.deepEqual(revisions, [...new Set(revisions)])
  })

  test('skips an SLA file with a resolved material as unpriceable', async ({ client, assert }) => {
    await seedPricingConfig()
    const resin = await Material.firstOrCreate(
      { name: 'Standard Resin' },
      { uuid: string.uuid(), technology: 'sla', isDefault: true }
    )
    const project = await Project.create({ uuid: string.uuid(), customerId: null, status: 'draft' })
    const projectFile = await ProjectFile.create({
      uuid: string.uuid(),
      projectId: project.id,
      materialId: resin.id,
      technology: 'sla',
      fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
      originalName: 'part.stl',
      mimeType: 'model/stl',
      fileSize: 1024,
      status: 'pending',
    })

    // Having a real material attached must not be enough to make this
    // priceable - the FDM-only calculator would run against a resin part.
    const response = await reportCompleted(client, projectFile)
    response.assertStatus(200)

    assert.lengthOf(await Quote.all(), 0)
  })

  test('does not quote when no pricing configuration is active', async ({ client, assert }) => {
    const { files } = await pendingProject(1)

    // The callback must still succeed - failing it would send the slicing job
    // back for a retry that cannot fix a pricing misconfiguration.
    const response = await reportCompleted(client, files[0])
    response.assertStatus(200)

    assert.lengthOf(await Quote.all(), 0)

    await files[0].refresh()
    assert.equal(files[0].status, 'completed')
  })
})
