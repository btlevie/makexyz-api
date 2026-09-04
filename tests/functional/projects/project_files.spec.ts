import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import string from '@adonisjs/core/helpers/string'
import drive from '@adonisjs/drive/services/main'
import limiter from '@adonisjs/limiter/services/main'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Customer from '#models/customer'
import Material from '#models/material'
import MaterialColor from '#models/material_color'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import User from '#models/user'
import env from '#start/env'

const cubeStlPath = app.makePath('tests/fixtures/cube.stl')

async function signup(client: any) {
  const email = `upload-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Upload',
    lastName: 'User',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  const customer = await Customer.findByOrFail('userId', user.id)

  return { session: response.session(), user, customer }
}

test.group('Projects | instant quote upload', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    drive.fake('s3')
    // Rate limit state is keyed per IP and every test shares one, so it has to
    // be reset or later tests would start hitting the cap set in .env.test.
    await limiter.clear()

    // The controller resolves a default material (and default color) by
    // technology rather than creating one on demand, so the defaults must
    // already exist.
    const pla = await Material.firstOrCreate(
      { name: 'PLA' },
      { uuid: string.uuid(), technology: 'fdm', isDefault: true, trueCostPerGram: '0.02' }
    )
    await MaterialColor.firstOrCreate(
      { materialId: pla.id, name: 'Black' },
      { uuid: string.uuid(), hex: null, isDefault: true }
    )
    const resin = await Material.firstOrCreate(
      { name: 'Standard Resin' },
      { uuid: string.uuid(), technology: 'sla', isDefault: true }
    )
    await MaterialColor.firstOrCreate(
      { materialId: resin.id, name: 'Clear' },
      { uuid: string.uuid(), hex: null, isDefault: true }
    )
    const nylon = await Material.firstOrCreate(
      { name: 'Nylon PA12' },
      { uuid: string.uuid(), technology: 'sls', isDefault: true }
    )
    await MaterialColor.firstOrCreate(
      { materialId: nylon.id, name: 'Natural White' },
      { uuid: string.uuid(), hex: null, isDefault: true }
    )

    return async () => {
      drive.restore()
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('accepts an anonymous upload and returns an access grant', async ({ client, assert }) => {
    const stl = await readFile(cubeStlPath)

    const response = await client
      .post('/v1/projects/files')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    response.assertStatus(200)
    response.assertBodyContains({
      data: { project: { status: 'draft', files: [{ originalName: 'cube.stl' }] } },
    })

    // The grant is what authorizes every follow-up request for this project.
    const grant = response.body().data.grant
    assert.isString(grant)
    assert.isNotEmpty(grant)

    const project = await Project.findByOrFail('uuid', response.body().data.project.uuid)
    // No account, so no owner yet - a customer is attached later, and only if
    // the visitor opts into having the quote emailed.
    assert.isNull(project.customerId)

    const projectFiles = await ProjectFile.query().where('projectId', project.id)
    assert.lengthOf(projectFiles, 1)
    assert.equal(projectFiles[0].status, 'pending')

    const storageKey = `${env.get('S3_FILE_STORAGE_KEY')}/${project.uuid}/${projectFiles[0].uuid}.stl`
    assert.isTrue(await drive.use('s3').exists(storageKey))
  })

  test('an authenticated upload attaches to the caller and needs no grant', async ({
    client,
    assert,
  }) => {
    const stl = await readFile(cubeStlPath)
    const { session, customer } = await signup(client)

    const response = await client
      .post('/v1/projects/files')
      .withSession(session)
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    response.assertStatus(200)
    assert.isUndefined(response.body().data.grant)

    const project = await Project.findByOrFail('uuid', response.body().data.project.uuid)
    assert.equal(project.customerId, customer.id)
  })

  test('defaults to fdm technology when omitted', async ({ client, assert }) => {
    const stl = await readFile(cubeStlPath)

    const response = await client
      .post('/v1/projects/files')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    response.assertStatus(200)

    const projectFiles = await ProjectFile.all()
    assert.lengthOf(projectFiles, 1)
    assert.equal(projectFiles[0].technology, 'fdm')
    assert.isNotNull(projectFiles[0].materialId)
  })

  test('uploading with technology=sla resolves the default SLA material', async ({
    client,
    assert,
  }) => {
    const stl = await readFile(cubeStlPath)

    const response = await client
      .post('/v1/projects/files')
      .field('technology', 'sla')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    response.assertStatus(200)

    const projectFiles = await ProjectFile.all()
    assert.equal(projectFiles[0].technology, 'sla')
    const resin = await Material.findByOrFail('name', 'Standard Resin')
    assert.equal(projectFiles[0].materialId, resin.id)
  })

  test('uploading with technology=sls resolves the default SLS material', async ({
    client,
    assert,
  }) => {
    const stl = await readFile(cubeStlPath)

    const response = await client
      .post('/v1/projects/files')
      .field('technology', 'sls')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    response.assertStatus(200)

    const projectFiles = await ProjectFile.all()
    assert.equal(projectFiles[0].technology, 'sls')
    const nylon = await Material.findByOrFail('name', 'Nylon PA12')
    assert.equal(projectFiles[0].materialId, nylon.id)
  })

  test('a grant lets the holder add another file to the same project', async ({
    client,
    assert,
  }) => {
    const stl = await readFile(cubeStlPath)

    const first = await client
      .post('/v1/projects/files')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })
    first.assertStatus(200)

    const grant = first.body().data.grant as string
    const project = first.body().data.project

    const second = await client
      .post('/v1/projects/files')
      .header('x-project-grant', grant)
      .field('projectUuid', project.uuid)
      .file('files[0]', stl, { filename: 'bracket.stl', contentType: 'model/stl' })

    second.assertStatus(200)

    const stored = await Project.findByOrFail('uuid', project.uuid)
    assert.lengthOf(await ProjectFile.query().where('projectId', stored.id), 2)
  })

  test('appending to a project without a grant is refused', async ({ client, assert }) => {
    const stl = await readFile(cubeStlPath)

    const first = await client
      .post('/v1/projects/files')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })
    first.assertStatus(200)
    const projectUuid = first.body().data.project.uuid

    const second = await client
      .post('/v1/projects/files')
      .field('projectUuid', projectUuid)
      .file('files[0]', stl, { filename: 'bracket.stl', contentType: 'model/stl' })

    second.assertStatus(404)

    const stored = await Project.findByOrFail('uuid', projectUuid)
    assert.lengthOf(await ProjectFile.query().where('projectId', stored.id), 1)
  })

  test("a grant for one project does not authorize another", async ({ client, assert }) => {
    const stl = await readFile(cubeStlPath)

    const mine = await client
      .post('/v1/projects/files')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })
    const theirs = await client
      .post('/v1/projects/files')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    const myGrant = mine.body().data.grant as string

    const response = await client
      .post('/v1/projects/files')
      .header('x-project-grant', myGrant)
      .field('projectUuid', theirs.body().data.project.uuid)
      .file('files[0]', stl, { filename: 'sneaky.stl', contentType: 'model/stl' })

    response.assertStatus(404)

    const victim = await Project.findByOrFail('uuid', theirs.body().data.project.uuid)
    assert.lengthOf(await ProjectFile.query().where('projectId', victim.id), 1)
  })

  test('a tampered grant is refused', async ({ client }) => {
    const stl = await readFile(cubeStlPath)

    const first = await client
      .post('/v1/projects/files')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    const response = await client
      .post('/v1/projects/files')
      .header('x-project-grant', `${first.body().data.grant}tampered`)
      .field('projectUuid', first.body().data.project.uuid)
      .file('files[0]', stl, { filename: 'bracket.stl', contentType: 'model/stl' })

    response.assertStatus(404)
  })

  test('throttles anonymous uploads once the limit is exceeded', async ({ client }) => {
    const stl = await readFile(cubeStlPath)
    const limit = Number(env.get('INSTANT_QUOTE_RATE_LIMIT_REQUESTS', 10))

    for (let attempt = 0; attempt < limit; attempt++) {
      const allowed = await client
        .post('/v1/projects/files')
        .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })
      allowed.assertStatus(200)
    }

    // Past the cap the request must be rejected before it costs another S3
    // write and slicing Lambda invocation.
    const blocked = await client
      .post('/v1/projects/files')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    blocked.assertStatus(429)
  })
})
