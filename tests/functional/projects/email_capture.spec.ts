import string from '@adonisjs/core/helpers/string'
import limiter from '@adonisjs/limiter/services/main'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Customer from '#models/customer'
import Project from '#models/project'
import { issueGrant } from '#services/project_grant_service'

async function anonymousProject() {
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: null,
    status: 'draft',
  })

  return { project, grant: issueGrant(project) }
}

test.group('Projects | email capture', (group) => {
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

  test('attaches a guest customer with no user account', async ({ client, assert }) => {
    const { project, grant } = await anonymousProject()

    const response = await client
      .post(`/v1/projects/${project.uuid}/email`)
      .header('x-project-grant', grant)
      .json({ email: 'lead@example.com' })

    response.assertStatus(200)

    await project.refresh()
    assert.isNotNull(project.customerId)

    const customer = await Customer.findOrFail(project.customerId!)
    assert.equal(customer.email, 'lead@example.com')
    // The whole point: a lead, not an account.
    assert.isNull(customer.userId)
  })

  test('normalizes the address and reuses one customer per lead', async ({ client, assert }) => {
    const first = await anonymousProject()
    const second = await anonymousProject()

    const a = await client
      .post(`/v1/projects/${first.project.uuid}/email`)
      .header('x-project-grant', first.grant)
      .json({ email: 'Repeat@Example.com' })
    a.assertStatus(200)

    const b = await client
      .post(`/v1/projects/${second.project.uuid}/email`)
      .header('x-project-grant', second.grant)
      .json({ email: 'repeat@example.com' })
    b.assertStatus(200)

    // Same person, two quotes - one lead record linked to both.
    const customers = await Customer.all()
    assert.lengthOf(customers, 1)
    assert.equal(customers[0].email, 'repeat@example.com')

    await first.project.refresh()
    await second.project.refresh()
    assert.equal(first.project.customerId, customers[0].id)
    assert.equal(second.project.customerId, customers[0].id)
  })

  test('is idempotent when submitted twice', async ({ client, assert }) => {
    const { project, grant } = await anonymousProject()

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await client
        .post(`/v1/projects/${project.uuid}/email`)
        .header('x-project-grant', grant)
        .json({ email: 'lead@example.com' })
      response.assertStatus(200)
    }

    assert.lengthOf(await Customer.all(), 1)
  })

  test('never reassigns a project that already has an owner', async ({ client, assert }) => {
    const { project, grant } = await anonymousProject()
    const owner = await Customer.create({ uuid: string.uuid(), email: 'owner@example.com' })
    project.customerId = owner.id
    await project.save()

    const response = await client
      .post(`/v1/projects/${project.uuid}/email`)
      .header('x-project-grant', grant)
      .json({ email: 'someone-else@example.com' })

    response.assertStatus(200)

    await project.refresh()
    assert.equal(project.customerId, owner.id)
    assert.lengthOf(await Customer.all(), 1)
  })

  test('requires a valid grant', async ({ client, assert }) => {
    const { project, grant } = await anonymousProject()
    const other = await anonymousProject()

    const missing = await client
      .post(`/v1/projects/${project.uuid}/email`)
      .json({ email: 'lead@example.com' })
    missing.assertStatus(404)

    const wrongProject = await client
      .post(`/v1/projects/${project.uuid}/email`)
      .header('x-project-grant', other.grant)
      .json({ email: 'lead@example.com' })
    wrongProject.assertStatus(404)

    const tampered = await client
      .post(`/v1/projects/${project.uuid}/email`)
      .header('x-project-grant', `${grant}tampered`)
      .json({ email: 'lead@example.com' })
    tampered.assertStatus(404)

    await project.refresh()
    assert.isNull(project.customerId)
  })

  test('rejects an invalid address', async ({ client, assert }) => {
    const { project, grant } = await anonymousProject()

    const response = await client
      .post(`/v1/projects/${project.uuid}/email`)
      .header('x-project-grant', grant)
      .json({ email: 'not-an-email' })

    response.assertStatus(422)

    await project.refresh()
    assert.isNull(project.customerId)
  })
})
