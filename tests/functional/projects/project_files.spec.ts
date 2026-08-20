import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import string from '@adonisjs/core/helpers/string'
import drive from '@adonisjs/drive/services/main'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Customer from '#models/customer'
import Material from '#models/material'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import User from '#models/user'
import env from '#start/env'

const cubeStlPath = app.makePath('tests/fixtures/cube.stl')

test.group('Projects | file upload', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    // drive.fake('s3')

    return async () => {
      drive.restore()
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('requires signup before uploading project files', async ({ client, assert }) => {
    const stl = await readFile(cubeStlPath)
    const email = `flow-${string.uuid()}@test.com`

    const unauthenticatedResponse = await client
      .post('/v1/projects/files')
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    unauthenticatedResponse.assertStatus(401)

    const signupResponse = await client.post('/v1/auth/new-customer').json({
      firstName: 'Flow',
      lastName: 'User',
      email,
      password: 'password123',
    })

    signupResponse.assertStatus(200)
    signupResponse.assertBodyContains({
      data: {
        firstName: 'Flow',
        lastName: 'User',
      },
    })

    const user = await User.findByOrFail('email', email)
    const customer = await Customer.findByOrFail('userId', user.id)
    assert.equal(customer.firstName, 'Flow')
    assert.equal(customer.lastName, 'User')

    const uploadResponse = await client
      .post('/v1/projects/files')
      .withSession(signupResponse.session())
      .file('files[0]', stl, { filename: 'cube.stl', contentType: 'model/stl' })

    uploadResponse.assertStatus(200)
    uploadResponse.assertBodyContains({
      data: {
        project: {
          status: 'draft',
          files: [{ originalName: 'cube.stl' }],
        },
      },
    })

    const createdProjectUuid = uploadResponse.body().data.project.uuid
    const project = await Project.findByOrFail('uuid', createdProjectUuid)
    assert.equal(project.customerId, customer.id)

    const projectFiles = await ProjectFile.query().where('projectId', project.id)
    assert.lengthOf(projectFiles, 1)
    assert.equal(projectFiles[0].originalName, 'cube.stl')

    const plaMaterial = await Material.findByOrFail('name', 'PLA')
    assert.equal(projectFiles[0].materialId, plaMaterial.id)

    const storageKey = `${env.get('S3_FILE_STORAGE_KEY')}/${project.uuid}/${projectFiles[0].uuid}.stl`
    assert.isTrue(await drive.use('s3').exists(storageKey))
  })
})
