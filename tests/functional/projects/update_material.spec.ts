import string from '@adonisjs/core/helpers/string'
import drive from '@adonisjs/drive/services/main'
import limiter from '@adonisjs/limiter/services/main'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import AuditEvent from '#models/audit_event'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Material from '#models/material'
import MaterialColor from '#models/material_color'
import PricingConfig from '#models/pricing_config'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import ProjectFileSliceVariant from '#models/project_file_slice_variant'
import Quote from '#models/quote'
import User from '#models/user'
import Vendor from '#models/vendor'
import { issueGrant } from '#services/project_grant_service'
import { activeVendorAttributes } from '#tests/helpers/vendors'

const DEFAULT_PRICING_VALUES = {
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

async function seedPricingConfig() {
  const config = await PricingConfig.create({
    technology: 'fdm',
    name: 'Test FDM pricing',
    version: 1,
    isActive: true,
  })
  await config.related('fdmValues').create(DEFAULT_PRICING_VALUES)
  return config
}

async function signup(client: any) {
  const email = `material-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Material',
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
 * A vendor only gets staff access once onboarded (isStaff checks the Vendor
 * record's status), so a promoted vendor gets an active Vendor record too.
 */
async function promote(user: User, role: 'admin' | 'vendor') {
  user.role = role
  await user.save()
  if (role === 'vendor') {
    await Vendor.create({ uuid: string.uuid(), userId: user.id, ...activeVendorAttributes() })
  }
}

async function createFdmMaterial(name: string, densityGPerCm3: string | null) {
  const material = await Material.create({
    uuid: string.uuid(),
    name,
    technology: 'fdm',
    isDefault: false,
    trueCostPerGram: '0.03',
    densityGPerCm3,
  })
  await material.related('colors').create({ uuid: string.uuid(), name: 'Black', isDefault: true })
  return material
}

/**
 * A fully sliced FDM file with its source model and all three gcode outputs on
 * the (faked) disk, assigned PLA (density 1.24). `customer` is null for the
 * anonymous instant-quote case.
 */
async function createSlicedFdmFile(customer: Customer | null = null) {
  const material = await Material.firstOrCreate(
    { name: 'PLA' },
    {
      uuid: string.uuid(),
      technology: 'fdm',
      isDefault: true,
      trueCostPerGram: '0.02',
      densityGPerCm3: '1.24',
    }
  )
  await MaterialColor.firstOrCreate(
    { materialId: material.id, name: 'Black' },
    { uuid: string.uuid(), isDefault: true }
  )
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer?.id ?? null,
    status: 'draft',
    source: 'instant_quote',
  })

  const fileUuid = string.uuid()
  const fileStorageKey = `projects/${project.uuid}/${fileUuid}.stl`
  const gcodeKeys = [
    `projects/${project.uuid}/${fileUuid}.gcode`,
    `projects/${project.uuid}/${fileUuid}_infill_probe.gcode`,
    `projects/${project.uuid}/${fileUuid}_layer_height_probe.gcode`,
  ]

  const disk = drive.use('s3')
  await disk.put(fileStorageKey, 'solid cube')
  for (const key of gcodeKeys) {
    await disk.put(key, 'G1 gcode')
  }

  const projectFile = await ProjectFile.create({
    uuid: fileUuid,
    projectId: project.id,
    materialId: material.id,
    technology: 'fdm',
    fileStorageKey,
    gcodeStorageKey: gcodeKeys[0],
    originalName: 'cube.stl',
    mimeType: 'model/stl',
    fileSize: 1024,
    status: 'completed',
    volume: 12.5,
    x: 100,
    y: 100,
    z: 100,
    infill: 15,
    layerHeight: 0.2,
    modelMaterialGrams: 50,
    supportMaterialGrams: 10,
    printTimeEstimatedSeconds: 7200,
  })

  await projectFile.related('sliceVariants').createMany(
    ['baseline', 'infill_probe', 'layer_height_probe'].map((variant, index) => ({
      variant: variant as 'baseline' | 'infill_probe' | 'layer_height_probe',
      infill: 15,
      layerHeight: 0.2,
      filamentUsedGrams: 60,
      printTimeEstimatedSeconds: 7200,
      gcodeStorageKey: gcodeKeys[index],
    }))
  )

  return { project, projectFile, material, fileStorageKey, gcodeKeys, grant: issueGrant(project) }
}

/** Puts the file on a quote in the given state. */
async function quoteFile(
  project: Project,
  projectFile: ProjectFile,
  status: 'draft' | 'sent' | 'accepted' | 'rejected'
) {
  const quote = await Quote.create({
    uuid: string.uuid(),
    projectId: project.id,
    revision: 1,
    subtotal: '23.45',
    tax: '0.00',
    total: '23.45',
    status,
    generatedBy: 'system',
  })

  await quote.related('items').create({
    projectFileId: projectFile.id,
    itemType: 'printing',
    description: projectFile.originalName,
    quantity: 1,
    unitPrice: '23.45',
    total: '23.45',
  })

  return quote
}

function patchMaterial(client: any, projectFile: ProjectFile) {
  return client.patch(`/v1/projects/files/${projectFile.uuid}/material`)
}

test.group('Projects | change file material', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    drive.fake('s3')
    await limiter.clear()

    return async () => {
      drive.restore()
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('swaps to another material of the same technology', async ({ client, assert }) => {
    const { projectFile, grant } = await createSlicedFdmFile()
    const petg = await createFdmMaterial('PETG', '1.24')

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: petg.uuid })

    response.assertStatus(200)
    response.assertBodyContains({ data: { material: { uuid: petg.uuid, name: 'PETG' } } })

    await projectFile.refresh()
    assert.equal(projectFile.materialId, petg.id)
    // Same density as PLA - nothing should be rescaled.
    assert.equal(projectFile.modelMaterialGrams, 50)
    assert.equal(projectFile.supportMaterialGrams, 10)
  })

  test('rescales grams and slice-variant filament by the density ratio', async ({
    client,
    assert,
  }) => {
    const { projectFile, grant } = await createSlicedFdmFile()
    // Exactly 2x PLA's density (1.24).
    const dense = await createFdmMaterial('Dense Filament', '2.48')

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: dense.uuid })

    response.assertStatus(200)

    await projectFile.refresh()
    assert.approximately(projectFile.modelMaterialGrams!, 100, 0.01)
    assert.approximately(projectFile.supportMaterialGrams!, 20, 0.01)

    const variants = await ProjectFileSliceVariant.query().where('projectFileId', projectFile.id)
    assert.lengthOf(variants, 3)
    for (const variant of variants) {
      assert.approximately(variant.filamentUsedGrams, 120, 0.01)
    }
  })

  test('does not rescale grams when the target material has no known density', async ({
    client,
    assert,
  }) => {
    const { projectFile, grant } = await createSlicedFdmFile()
    const unknown = await createFdmMaterial('Mystery Filament', null)

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: unknown.uuid })

    response.assertStatus(200)

    await projectFile.refresh()
    assert.equal(projectFile.modelMaterialGrams, 50)
    assert.equal(projectFile.supportMaterialGrams, 10)
  })

  test('is a no-op when the material already matches', async ({ client, assert }) => {
    const { projectFile, grant, material } = await createSlicedFdmFile()

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: material.uuid })

    response.assertStatus(200)

    await projectFile.refresh()
    assert.equal(projectFile.materialId, material.id)
    assert.equal(projectFile.modelMaterialGrams, 50)
  })

  test('rejects a material whose technology does not match the file', async ({
    client,
    assert,
  }) => {
    const { projectFile, grant, material } = await createSlicedFdmFile()
    const resin = await Material.firstOrCreate(
      { name: 'Standard Resin' },
      { uuid: string.uuid(), technology: 'sla', isDefault: true }
    )

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: resin.uuid })

    response.assertStatus(422)

    await projectFile.refresh()
    assert.equal(projectFile.materialId, material.id)
  })

  test('returns 404 for an unknown material', async ({ client }) => {
    const { projectFile, grant } = await createSlicedFdmFile()

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: string.uuid() })

    response.assertStatus(404)
  })

  test('returns 404 for an unknown project file', async ({ client }) => {
    const petg = await createFdmMaterial('PETG', '1.24')

    const response = await client
      .patch(`/v1/projects/files/${string.uuid()}/material`)
      .json({ materialUuid: petg.uuid })

    response.assertStatus(404)
  })

  test('generates a new quote revision for a completed file', async ({ client, assert }) => {
    await seedPricingConfig()
    const { project, projectFile, grant } = await createSlicedFdmFile()
    const petg = await createFdmMaterial('PETG', '1.24')

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: petg.uuid })

    response.assertStatus(200)

    const quotes = await Quote.query().where('projectId', project.id)
    assert.lengthOf(quotes, 1)
    assert.equal(quotes[0].revision, 1)
  })

  test('does not generate a quote when the file is not completed', async ({ client, assert }) => {
    await seedPricingConfig()
    const { project, projectFile, grant } = await createSlicedFdmFile()
    projectFile.status = 'pending'
    await projectFile.save()
    const petg = await createFdmMaterial('PETG', '1.24')

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: petg.uuid })

    response.assertStatus(200)
    assert.lengthOf(await Quote.query().where('projectId', project.id), 0)
  })
})

test.group('Projects | change file material | locks', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    drive.fake('s3')
    await limiter.clear()

    return async () => {
      drive.restore()
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('an active checkout session locks the change', async ({ client, assert }) => {
    const { project, projectFile, grant, material } = await createSlicedFdmFile()
    await CheckoutSession.create({ uuid: string.uuid(), projectId: project.id, status: 'active' })
    const petg = await createFdmMaterial('PETG', '1.24')

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: petg.uuid })

    response.assertStatus(409)

    await projectFile.refresh()
    assert.equal(projectFile.materialId, material.id)
  })

  test('a completed checkout session locks the change', async ({ client, assert }) => {
    const { project, projectFile, grant, material } = await createSlicedFdmFile()
    await CheckoutSession.create({ uuid: string.uuid(), projectId: project.id, status: 'completed' })
    const petg = await createFdmMaterial('PETG', '1.24')

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: petg.uuid })

    response.assertStatus(409)
    await projectFile.refresh()
    assert.equal(projectFile.materialId, material.id)
  })

  test('an expired checkout session does not lock', async ({ client, assert }) => {
    const { project, projectFile, grant } = await createSlicedFdmFile()
    await CheckoutSession.create({ uuid: string.uuid(), projectId: project.id, status: 'expired' })
    const petg = await createFdmMaterial('PETG', '1.24')

    const response = await patchMaterial(client, projectFile)
      .header('x-project-grant', grant)
      .json({ materialUuid: petg.uuid })

    response.assertStatus(200)
    await projectFile.refresh()
    assert.equal(projectFile.materialId, petg.id)
  })

  for (const status of ['sent', 'accepted'] as const) {
    test(`a ${status} quote locks the change`, async ({ client, assert }) => {
      const { project, projectFile, grant, material } = await createSlicedFdmFile()
      await quoteFile(project, projectFile, status)
      const petg = await createFdmMaterial('PETG', '1.24')

      const response = await patchMaterial(client, projectFile)
        .header('x-project-grant', grant)
        .json({ materialUuid: petg.uuid })

      response.assertStatus(409)
      await projectFile.refresh()
      assert.equal(projectFile.materialId, material.id)
    })
  }

  for (const status of ['draft', 'rejected'] as const) {
    test(`a ${status} quote does not lock the change`, async ({ client, assert }) => {
      const { project, projectFile, grant } = await createSlicedFdmFile()
      await quoteFile(project, projectFile, status)
      const petg = await createFdmMaterial('PETG', '1.24')

      const response = await patchMaterial(client, projectFile)
        .header('x-project-grant', grant)
        .json({ materialUuid: petg.uuid })

      response.assertStatus(200)
      await projectFile.refresh()
      assert.equal(projectFile.materialId, petg.id)
    })
  }

  for (const role of ['admin', 'vendor'] as const) {
    test(`a ${role} can override a checkout lock, and it is audited`, async ({
      client,
      assert,
    }) => {
      const staff = await signup(client)
      await promote(staff.user, role)

      const { project, projectFile, material } = await createSlicedFdmFile()
      await CheckoutSession.create({ uuid: string.uuid(), projectId: project.id, status: 'active' })
      const petg = await createFdmMaterial('PETG', '1.24')

      const response = await patchMaterial(client, projectFile)
        .withSession(staff.session)
        .json({ materialUuid: petg.uuid })

      response.assertStatus(200)

      await projectFile.refresh()
      assert.equal(projectFile.materialId, petg.id)

      const events = await AuditEvent.all()
      assert.lengthOf(events, 1)
      assert.equal(events[0].entityType, 'project_file')
      assert.equal(events[0].entityId, projectFile.id)
      assert.equal(events[0].userId, staff.user.id)
      assert.deepInclude(events[0].payload, {
        reason: 'material_changed_after_lock',
        from: material.uuid,
        to: petg.uuid,
        overriddenByRole: role,
        lockReason: 'checkout_started',
      })
    })
  }

  test('an unlocked change is not audited', async ({ client, assert }) => {
    const staff = await signup(client)
    await promote(staff.user, 'admin')
    const { projectFile } = await createSlicedFdmFile()
    const petg = await createFdmMaterial('PETG', '1.24')

    const response = await patchMaterial(client, projectFile)
      .withSession(staff.session)
      .json({ materialUuid: petg.uuid })

    response.assertStatus(200)
    assert.lengthOf(await AuditEvent.all(), 0)
  })
})
