import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import string from '@adonisjs/core/helpers/string'
import drive from '@adonisjs/drive/services/main'
import limiter from '@adonisjs/limiter/services/main'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import CheckoutSession from '#models/checkout_session'
import Material from '#models/material'
import MaterialColor from '#models/material_color'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import { issueGrant } from '#services/project_grant_service'

const cubeStlPath = app.makePath('tests/fixtures/cube.stl')

async function createMaterialWithColors(
  technology: 'fdm' | 'sla',
  name: string,
  colors: { name: string; isDefault: boolean }[],
  options: { isDefaultMaterial?: boolean } = {}
) {
  const material = await Material.create({
    uuid: string.uuid(),
    name,
    technology,
    isDefault: options.isDefaultMaterial ?? false,
    trueCostPerGram: technology === 'fdm' ? '0.02' : null,
  })

  const created: MaterialColor[] = []
  for (const color of colors) {
    created.push(
      await material
        .related('colors')
        .create({ uuid: string.uuid(), name: color.name, isDefault: color.isDefault })
    )
  }

  return { material, colors: created }
}

/** A completed project file, assigned the material's default color. */
async function createSlicedFile(technology: 'fdm' | 'sla', material: Material) {
  const defaultColor = await MaterialColor.query()
    .where('materialId', material.id)
    .where('isDefault', true)
    .firstOrFail()

  const project = await Project.create({
    uuid: string.uuid(),
    customerId: null,
    status: 'draft',
    source: 'instant_quote',
  })

  const fileUuid = string.uuid()
  const projectFile = await ProjectFile.create({
    uuid: fileUuid,
    projectId: project.id,
    materialId: material.id,
    colorId: defaultColor.id,
    technology,
    fileStorageKey: `projects/${project.uuid}/${fileUuid}.stl`,
    originalName: 'cube.stl',
    mimeType: 'model/stl',
    fileSize: 1024,
    status: 'completed',
  })

  return { project, projectFile, grant: issueGrant(project) }
}

function patchColor(client: any, projectFile: ProjectFile) {
  return client.patch(`/v1/projects/files/${projectFile.uuid}/color`)
}

test.group('Projects | change file color', (group) => {
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

  test('changes to a valid color on the current material', async ({ client, assert }) => {
    const { material, colors } = await createMaterialWithColors('fdm', 'PLA', [
      { name: 'Black', isDefault: true },
      { name: 'White', isDefault: false },
    ])
    const white = colors.find((c) => c.name === 'White')!
    const { projectFile, grant } = await createSlicedFile('fdm', material)

    const response = await patchColor(client, projectFile)
      .header('x-project-grant', grant)
      .json({ colorUuid: white.uuid })

    response.assertStatus(200)
    response.assertBodyContains({ data: { color: { uuid: white.uuid, name: 'White' } } })

    await projectFile.refresh()
    assert.equal(projectFile.colorId, white.id)
  })

  test('rejects a color uuid not on the current material', async ({ client, assert }) => {
    const { material: pla } = await createMaterialWithColors('fdm', 'PLA', [
      { name: 'Black', isDefault: true },
    ])
    const { colors: petgColors } = await createMaterialWithColors('fdm', 'PETG', [
      { name: 'Red', isDefault: true },
    ])
    const { projectFile, grant } = await createSlicedFile('fdm', pla)
    const foreignColor = petgColors[0]

    const response = await patchColor(client, projectFile)
      .header('x-project-grant', grant)
      .json({ colorUuid: foreignColor.uuid })

    response.assertStatus(422)
    await projectFile.refresh()
    assert.notEqual(projectFile.colorId, foreignColor.id)
  })

  test('returns 404 for an unknown project file', async ({ client }) => {
    const response = await client
      .patch(`/v1/projects/files/${string.uuid()}/color`)
      .json({ colorUuid: string.uuid() })

    response.assertStatus(404)
  })

  test('upload assigns the material default color', async ({ client, assert }) => {
    const { material } = await createMaterialWithColors(
      'fdm',
      'PLA',
      [
        { name: 'Black', isDefault: true },
        { name: 'White', isDefault: false },
      ],
      { isDefaultMaterial: true }
    )
    const stl = await readFile(cubeStlPath)

    const response = await client
      .post('/v1/projects/files')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    response.assertStatus(200)

    const projectFiles = await ProjectFile.all()
    assert.lengthOf(projectFiles, 1)
    const defaultColor = await MaterialColor.query()
      .where('materialId', material.id)
      .where('isDefault', true)
      .firstOrFail()
    assert.equal(projectFiles[0].colorId, defaultColor.id)
  })

  test('color carries over on a technology switch when the new material offers it', async ({
    client,
    assert,
  }) => {
    const { material: pla } = await createMaterialWithColors('fdm', 'PLA', [
      { name: 'Black', isDefault: true },
      { name: 'White', isDefault: false },
    ])
    const { material: resin } = await createMaterialWithColors(
      'sla',
      'Standard Resin',
      [
        { name: 'Clear', isDefault: true },
        { name: 'White', isDefault: false },
      ],
      { isDefaultMaterial: true }
    )
    const white = await MaterialColor.query()
      .where('materialId', pla.id)
      .where('name', 'White')
      .firstOrFail()
    const { projectFile, grant } = await createSlicedFile('fdm', pla)
    projectFile.colorId = white.id
    await projectFile.save()

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/technology`)
      .header('x-project-grant', grant)
      .json({ technology: 'sla' })

    response.assertStatus(200)
    await projectFile.refresh()
    const resinWhite = await MaterialColor.query()
      .where('materialId', resin.id)
      .where('name', 'White')
      .firstOrFail()
    assert.equal(projectFile.colorId, resinWhite.id)
  })

  test('falls back to the new material default on a technology switch when the color does not exist there', async ({
    client,
    assert,
  }) => {
    const { material: pla } = await createMaterialWithColors('fdm', 'PLA', [
      { name: 'Black', isDefault: true },
      { name: 'White', isDefault: false },
    ])
    const { material: resin } = await createMaterialWithColors(
      'sla',
      'Standard Resin',
      [{ name: 'Clear', isDefault: true }],
      { isDefaultMaterial: true }
    )
    const black = await MaterialColor.query()
      .where('materialId', pla.id)
      .where('name', 'Black')
      .firstOrFail()
    const { projectFile, grant } = await createSlicedFile('fdm', pla)
    projectFile.colorId = black.id
    await projectFile.save()

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/technology`)
      .header('x-project-grant', grant)
      .json({ technology: 'sla' })

    response.assertStatus(200)
    await projectFile.refresh()
    const resinDefault = await MaterialColor.query()
      .where('materialId', resin.id)
      .where('isDefault', true)
      .firstOrFail()
    assert.equal(projectFile.colorId, resinDefault.id)
  })

  test('color carries over on a material switch when the new material offers it', async ({
    client,
    assert,
  }) => {
    const { material: pla } = await createMaterialWithColors('fdm', 'PLA', [
      { name: 'Black', isDefault: true },
      { name: 'White', isDefault: false },
    ])
    const { material: petg } = await createMaterialWithColors('fdm', 'PETG', [
      { name: 'Red', isDefault: true },
      { name: 'White', isDefault: false },
    ])
    const white = await MaterialColor.query()
      .where('materialId', pla.id)
      .where('name', 'White')
      .firstOrFail()
    const { projectFile, grant } = await createSlicedFile('fdm', pla)
    projectFile.colorId = white.id
    await projectFile.save()

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/material`)
      .header('x-project-grant', grant)
      .json({ materialUuid: petg.uuid })

    response.assertStatus(200)
    await projectFile.refresh()
    const petgWhite = await MaterialColor.query()
      .where('materialId', petg.id)
      .where('name', 'White')
      .firstOrFail()
    assert.equal(projectFile.colorId, petgWhite.id)
  })

  test('falls back to the new material default on a material switch when the color does not exist there', async ({
    client,
    assert,
  }) => {
    const { material: pla } = await createMaterialWithColors('fdm', 'PLA', [
      { name: 'Black', isDefault: true },
      { name: 'White', isDefault: false },
    ])
    const { material: petg } = await createMaterialWithColors('fdm', 'PETG', [
      { name: 'Red', isDefault: true },
    ])
    const black = await MaterialColor.query()
      .where('materialId', pla.id)
      .where('name', 'Black')
      .firstOrFail()
    const { projectFile, grant } = await createSlicedFile('fdm', pla)
    projectFile.colorId = black.id
    await projectFile.save()

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/material`)
      .header('x-project-grant', grant)
      .json({ materialUuid: petg.uuid })

    response.assertStatus(200)
    await projectFile.refresh()
    const petgDefault = await MaterialColor.query()
      .where('materialId', petg.id)
      .where('isDefault', true)
      .firstOrFail()
    assert.equal(projectFile.colorId, petgDefault.id)
  })
})

test.group('Projects | change file color | locks', (group) => {
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

  test('an active checkout session does not block a color change', async ({ client, assert }) => {
    const { material } = await createMaterialWithColors('fdm', 'PLA', [
      { name: 'Black', isDefault: true },
      { name: 'White', isDefault: false },
    ])
    const { project, projectFile, grant } = await createSlicedFile('fdm', material)
    await CheckoutSession.create({ projectId: project.id, status: 'active' })
    const white = await MaterialColor.query()
      .where('materialId', material.id)
      .where('name', 'White')
      .firstOrFail()

    const response = await patchColor(client, projectFile)
      .header('x-project-grant', grant)
      .json({ colorUuid: white.uuid })

    response.assertStatus(200)
    await projectFile.refresh()
    assert.equal(projectFile.colorId, white.id)
  })

  test('a sent quote does not block a color change', async ({ client, assert }) => {
    const { material } = await createMaterialWithColors('fdm', 'PLA', [
      { name: 'Black', isDefault: true },
      { name: 'White', isDefault: false },
    ])
    const { project, projectFile, grant } = await createSlicedFile('fdm', material)
    const quote = await Quote.create({
      uuid: string.uuid(),
      projectId: project.id,
      revision: 1,
      subtotal: '23.45',
      tax: '0.00',
      total: '23.45',
      status: 'sent',
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
    const white = await MaterialColor.query()
      .where('materialId', material.id)
      .where('name', 'White')
      .firstOrFail()

    const response = await patchColor(client, projectFile)
      .header('x-project-grant', grant)
      .json({ colorUuid: white.uuid })

    response.assertStatus(200)
    await projectFile.refresh()
    assert.equal(projectFile.colorId, white.id)
  })
})
