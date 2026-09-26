import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import ProductionTimeConfig from '#models/production_time_config'
import Quote from '#models/quote'
import { issueGrant } from '#services/project_grant_service'

const DAY_SECONDS = 24 * 60 * 60

async function seedProductionTimeConfig() {
  const config = await ProductionTimeConfig.create({
    name: 'Test production time',
    version: 1,
    isActive: true,
    standardBusinessDays: 5,
    baseFee: '5.00',
    growthRate: '1.6',
  })
  await config
    .related('tiers')
    .createMany([
      { businessDays: 5 },
      { businessDays: 3 },
      { businessDays: 2 },
      { businessDays: 1 },
    ])
  return config
}

async function createQuoteWithItems(printTimesSeconds: number[]) {
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: null,
    status: 'draft',
  })
  const quote = await Quote.create({
    uuid: string.uuid(),
    projectId: project.id,
    revision: 1,
    subtotal: '100.00',
    tax: '0.00',
    total: '100.00',
    status: 'draft',
    generatedBy: 'system',
  })
  for (const printTimeEstimatedSeconds of printTimesSeconds) {
    const projectFile = await ProjectFile.create({
      uuid: string.uuid(),
      projectId: project.id,
      fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
      originalName: 'cube.stl',
      mimeType: 'model/stl',
      fileSize: 1024,
      status: 'completed',
      printTimeEstimatedSeconds,
    })
    await quote.related('items').create({
      projectFileId: projectFile.id,
      itemType: 'printing',
      description: projectFile.originalName,
      quantity: 1,
      unitPrice: '50.00',
      total: '50.00',
    })
  }

  return { project, quote, grant: issueGrant(project) }
}

function optionsUrl(project: Project, quote: Quote) {
  return `/v1/projects/${project.uuid}/quotes/${quote.uuid}/production-time-options`
}

test.group('Quotes | production-time options', (group) => {
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

  test('lists every tier, standard first, with fees', async ({ client, assert }) => {
    await seedProductionTimeConfig()
    const { project, quote, grant } = await createQuoteWithItems([3600])

    const response = await client.get(optionsUrl(project, quote)).header('x-project-grant', grant)

    response.assertStatus(200)
    // fee = 5.00 * (1.6 ^ daysSaved - 1)
    assert.deepEqual((response.body() as { data: unknown[] }).data, [
      { businessDays: 5, feeAmount: '0.00', isStandard: true, available: true },
      { businessDays: 3, feeAmount: '7.80', isStandard: false, available: true },
      { businessDays: 2, feeAmount: '15.48', isStandard: false, available: true },
      { businessDays: 1, feeAmount: '27.77', isStandard: false, available: true },
    ])
  })

  test('marks tiers the slowest part cannot meet unavailable', async ({ client, assert }) => {
    await seedProductionTimeConfig()
    // The slow part (2.5 days) decides, not the fast one.
    const { project, quote, grant } = await createQuoteWithItems([3600, 2.5 * DAY_SECONDS])

    const response = await client.get(optionsUrl(project, quote)).header('x-project-grant', grant)

    response.assertStatus(200)
    assert.deepEqual(
      (response.body() as { data: any[] }).data.map((option) => [
        option.businessDays,
        option.available,
      ]),
      [
        [5, true],
        [3, true],
        [2, false],
        [1, false],
      ]
    )
  })

  test('requires the project grant', async ({ client }) => {
    await seedProductionTimeConfig()
    const { project, quote } = await createQuoteWithItems([3600])
    const other = await createQuoteWithItems([3600])

    const anonymous = await client.get(optionsUrl(project, quote))
    anonymous.assertStatus(404)

    const wrongGrant = await client
      .get(optionsUrl(project, quote))
      .header('x-project-grant', other.grant)
    wrongGrant.assertStatus(404)
  })

  test("404s for another project's quote", async ({ client }) => {
    await seedProductionTimeConfig()
    const { project, grant } = await createQuoteWithItems([3600])
    const other = await createQuoteWithItems([3600])

    const response = await client
      .get(optionsUrl(project, other.quote))
      .header('x-project-grant', grant)

    response.assertStatus(404)
    response.assertBodyContains({ error: 'Quote not found' })
  })
})
