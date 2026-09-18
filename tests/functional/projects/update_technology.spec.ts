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
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import ProjectFileSliceVariant from '#models/project_file_slice_variant'
import Quote from '#models/quote'
import User from '#models/user'
import { issueGrant } from '#services/project_grant_service'

async function signup(client: any) {
  const email = `tech-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Tech',
    lastName: 'User',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  const customer = await Customer.findByOrFail('userId', user.id)

  return { session: response.session(), user, customer }
}

async function promote(user: User, role: 'admin' | 'vendor') {
  user.role = role
  await user.save()
}

/**
 * A fully sliced FDM file with its source model and all three gcode outputs on
 * the (faked) disk. `customer` is null for the anonymous instant-quote case.
 */
async function createSlicedFdmFile(customer: Customer | null = null) {
  const material = await Material.firstOrCreate(
    { name: 'PLA' },
    { uuid: string.uuid(), technology: 'fdm', isDefault: true, trueCostPerGram: '0.02' }
  )
  await MaterialColor.firstOrCreate(
    { materialId: material.id, name: 'Black' },
    { uuid: string.uuid(), hex: null, isDefault: true }
  )
  // Switching to SLA in this group resolves this as the default SLA material.
  const resin = await Material.firstOrCreate(
    { name: 'Standard Resin' },
    { uuid: string.uuid(), technology: 'sla', isDefault: true }
  )
  await MaterialColor.firstOrCreate(
    { materialId: resin.id, name: 'Clear' },
    { uuid: string.uuid(), hex: null, isDefault: true }
  )
  // Switching to SLS in this group resolves this as the default SLS material.
  const nylon = await Material.firstOrCreate(
    { name: 'Nylon PA12' },
    { uuid: string.uuid(), technology: 'sls', isDefault: true }
  )
  await MaterialColor.firstOrCreate(
    { materialId: nylon.id, name: 'Natural White' },
    { uuid: string.uuid(), hex: null, isDefault: true }
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
    surfaceAreaMm2: 500,
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

function patchTechnology(client: any, projectFile: ProjectFile) {
  return client.patch(`/v1/projects/files/${projectFile.uuid}/technology`)
}

test.group('Projects | change file technology', (group) => {
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

  test('an anonymous customer with a grant can switch to sla', async ({ client, assert }) => {
    const { projectFile, grant, gcodeKeys } = await createSlicedFdmFile()

    const response = await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'sla' })

    response.assertStatus(200)

    await projectFile.refresh()
    assert.equal(projectFile.technology, 'sla')
    assert.equal(projectFile.status, 'pending')
    const resin = await Material.findByOrFail('name', 'Standard Resin')
    assert.equal(projectFile.materialId, resin.id)

    // Slicer-derived data is technology-specific and must not survive.
    for (const field of [
      'gcodeStorageKey',
      'volume',
      'x',
      'y',
      'z',
      'infill',
      'layerHeight',
      'supportMaterialGrams',
      'modelMaterialGrams',
      'printTimeEstimatedSeconds',
      'surfaceAreaMm2',
    ] as const) {
      assert.isNull(projectFile[field], `${field} should be cleared`)
    }

    assert.lengthOf(await ProjectFileSliceVariant.query().where('projectFileId', projectFile.id), 0)
    for (const key of gcodeKeys) {
      assert.isFalse(await drive.use('s3').exists(key))
    }
  })

  test('switching to sls resolves the default SLS material and color', async ({
    client,
    assert,
  }) => {
    const { projectFile, grant } = await createSlicedFdmFile()

    const response = await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'sls' })

    response.assertStatus(200)

    await projectFile.refresh()
    assert.equal(projectFile.technology, 'sls')
    assert.equal(projectFile.status, 'pending')
    assert.isNull(projectFile.surfaceAreaMm2)
    const nylon = await Material.findByOrFail('name', 'Nylon PA12')
    assert.equal(projectFile.materialId, nylon.id)
  })

  test('the uploaded source model is never deleted', async ({ client, assert }) => {
    const { projectFile, grant, fileStorageKey } = await createSlicedFdmFile()

    await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'sla' })

    assert.isTrue(await drive.use('s3').exists(fileStorageKey))
  })

  test('switching back to fdm resolves the PLA material again', async ({ client, assert }) => {
    const { projectFile, grant } = await createSlicedFdmFile()

    await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'sla' })
    const back = await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'fdm' })

    back.assertStatus(200)

    await projectFile.refresh()
    assert.equal(projectFile.technology, 'fdm')
    const pla = await Material.findByOrFail('name', 'PLA')
    assert.equal(projectFile.materialId, pla.id)
  })

  test('is a no-op when the technology already matches', async ({ client, assert }) => {
    const { projectFile, grant, gcodeKeys } = await createSlicedFdmFile()

    const response = await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'fdm' })

    response.assertStatus(200)

    await projectFile.refresh()
    assert.equal(projectFile.status, 'completed')
    assert.equal(projectFile.infill, 15)
    assert.lengthOf(await ProjectFileSliceVariant.query().where('projectFileId', projectFile.id), 3)
    for (const key of gcodeKeys) {
      assert.isTrue(await drive.use('s3').exists(key))
    }
  })

  test('an authenticated customer can change their own file', async ({ client, assert }) => {
    const { session, customer } = await signup(client)
    const { projectFile } = await createSlicedFdmFile(customer)

    const response = await patchTechnology(client, projectFile)
      .withSession(session)
      .json({ technology: 'sla' })

    response.assertStatus(200)

    await projectFile.refresh()
    assert.equal(projectFile.technology, 'sla')
  })

  test('refuses callers with no grant and no ownership', async ({ client, assert }) => {
    const { projectFile } = await createSlicedFdmFile()
    const other = await createSlicedFdmFile()

    const anonymous = await patchTechnology(client, projectFile).json({ technology: 'sla' })
    anonymous.assertStatus(404)

    const wrongGrant = await patchTechnology(client, projectFile)
      .header('x-project-grant', other.grant)
      .json({ technology: 'sla' })
    wrongGrant.assertStatus(404)

    const tampered = await patchTechnology(client, projectFile)
      .header('x-project-grant', 'not-a-real-grant')
      .json({ technology: 'sla' })
    tampered.assertStatus(404)

    const intruder = await signup(client)
    const otherCustomer = await patchTechnology(client, projectFile)
      .withSession(intruder.session)
      .json({ technology: 'sla' })
    otherCustomer.assertStatus(404)

    await projectFile.refresh()
    assert.equal(projectFile.technology, 'fdm')
  })

  test('returns 404 for an unknown project file', async ({ client }) => {
    const response = await client
      .patch(`/v1/projects/files/${string.uuid()}/technology`)
      .json({ technology: 'sla' })

    response.assertStatus(404)
  })

  test('rejects an unsupported technology', async ({ client }) => {
    const { projectFile, grant } = await createSlicedFdmFile()

    const response = await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'dlp' } as any)

    response.assertStatus(422)
  })

  test('throttles once the limit is exceeded', async ({ client }) => {
    const limit = 5
    for (let attempt = 0; attempt < limit; attempt++) {
      const { projectFile, grant } = await createSlicedFdmFile()
      const allowed = await patchTechnology(client, projectFile)
        .header('x-project-grant', grant)
        .json({ technology: 'sla' })
      allowed.assertStatus(200)
    }

    const { projectFile, grant } = await createSlicedFdmFile()
    const blocked = await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'sla' })

    blocked.assertStatus(429)
  })
})

test.group('Projects | change file technology | locks', (group) => {
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
    const { project, projectFile, grant } = await createSlicedFdmFile()
    await CheckoutSession.create({ uuid: string.uuid(), projectId: project.id, status: 'active' })

    const response = await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'sla' })

    response.assertStatus(409)

    await projectFile.refresh()
    assert.equal(projectFile.technology, 'fdm')
    assert.equal(projectFile.status, 'completed')
  })

  test('a completed checkout session locks the change', async ({ client, assert }) => {
    const { project, projectFile, grant } = await createSlicedFdmFile()
    await CheckoutSession.create({ uuid: string.uuid(), projectId: project.id, status: 'completed' })

    const response = await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'sla' })

    response.assertStatus(409)
    await projectFile.refresh()
    assert.equal(projectFile.technology, 'fdm')
  })

  test('an expired checkout session does not lock', async ({ client, assert }) => {
    const { project, projectFile, grant } = await createSlicedFdmFile()
    await CheckoutSession.create({ uuid: string.uuid(), projectId: project.id, status: 'expired' })

    const response = await patchTechnology(client, projectFile)
      .header('x-project-grant', grant)
      .json({ technology: 'sla' })

    response.assertStatus(200)
    await projectFile.refresh()
    assert.equal(projectFile.technology, 'sla')
  })

  for (const status of ['sent', 'accepted'] as const) {
    test(`a ${status} quote locks the change`, async ({ client, assert }) => {
      const { project, projectFile, grant } = await createSlicedFdmFile()
      await quoteFile(project, projectFile, status)

      const response = await patchTechnology(client, projectFile)
        .header('x-project-grant', grant)
        .json({ technology: 'sla' })

      response.assertStatus(409)
      await projectFile.refresh()
      assert.equal(projectFile.technology, 'fdm')
    })
  }

  for (const status of ['draft', 'rejected'] as const) {
    test(`a ${status} quote does not lock the change`, async ({ client, assert }) => {
      const { project, projectFile, grant } = await createSlicedFdmFile()
      await quoteFile(project, projectFile, status)

      const response = await patchTechnology(client, projectFile)
        .header('x-project-grant', grant)
        .json({ technology: 'sla' })

      // The instant-quote default is `draft`, so this is the common case - a
      // customer must stay free to change technology right up to checkout.
      response.assertStatus(200)
      await projectFile.refresh()
      assert.equal(projectFile.technology, 'sla')
    })
  }

  test('a sibling file left off the quote is not locked', async ({ client, assert }) => {
    const { project, projectFile, grant } = await createSlicedFdmFile()
    await quoteFile(project, projectFile, 'sent')

    const sibling = await ProjectFile.create({
      uuid: string.uuid(),
      projectId: project.id,
      technology: 'fdm',
      fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
      originalName: 'bracket.stl',
      mimeType: 'model/stl',
      fileSize: 2048,
      status: 'completed',
    })

    const response = await patchTechnology(client, sibling)
      .header('x-project-grant', grant)
      .json({ technology: 'sla' })

    response.assertStatus(200)
    await sibling.refresh()
    assert.equal(sibling.technology, 'sla')
  })

  for (const role of ['admin', 'vendor'] as const) {
    test(`a ${role} can override a checkout lock, and it is audited`, async ({
      client,
      assert,
    }) => {
      const staff = await signup(client)
      await promote(staff.user, role)

      const { project, projectFile } = await createSlicedFdmFile()
      await CheckoutSession.create({ uuid: string.uuid(), projectId: project.id, status: 'active' })

      const response = await patchTechnology(client, projectFile)
        .withSession(staff.session)
        .json({ technology: 'sla' })

      response.assertStatus(200)

      await projectFile.refresh()
      assert.equal(projectFile.technology, 'sla')

      const events = await AuditEvent.all()
      assert.lengthOf(events, 1)
      assert.equal(events[0].entityType, 'project_file')
      assert.equal(events[0].entityId, projectFile.id)
      assert.equal(events[0].userId, staff.user.id)
      assert.deepInclude(events[0].payload, {
        reason: 'technology_changed_after_lock',
        from: 'fdm',
        to: 'sla',
        overriddenByRole: role,
        lockReason: 'checkout_started',
      })
    })
  }

  test('an unlocked change is not audited', async ({ client, assert }) => {
    const staff = await signup(client)
    await promote(staff.user, 'admin')
    const { projectFile } = await createSlicedFdmFile()

    const response = await patchTechnology(client, projectFile)
      .withSession(staff.session)
      .json({ technology: 'sla' })

    response.assertStatus(200)
    assert.lengthOf(await AuditEvent.all(), 0)
  })
})
