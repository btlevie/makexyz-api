import string from '@adonisjs/core/helpers/string'
import drive from '@adonisjs/drive/services/main'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import AuditEvent from '#models/audit_event'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import QuoteItem from '#models/quote_item'
import ExpireAbandonedProjects from '#jobs/expire_abandoned_projects'
import PurgeExpiredProjects from '#jobs/purge_expired_projects'

/**
 * Runs a job's body directly, without standing up a worker process. Neither job
 * reads `this.payload` (which is getter-only), so the bare instance is enough.
 */
function runJob(JobClass: any) {
  return new JobClass().execute()
}

type ProjectOverrides = {
  source?: 'instant_quote' | 'manual'
  status?: 'draft' | 'quoted' | 'expired'
  ageDays?: number
  customerId?: number | null
  expiredDaysAgo?: number
}

async function createProject(overrides: ProjectOverrides = {}) {
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: overrides.customerId ?? null,
    status: overrides.status ?? 'draft',
    source: overrides.source ?? 'instant_quote',
    expiredAt:
      overrides.expiredDaysAgo === undefined
        ? null
        : DateTime.now().minus({ days: overrides.expiredDaysAgo }),
  })

  if (overrides.ageDays !== undefined) {
    // updated_at is auto-managed, so age has to be forced through the query
    // builder rather than the model.
    await Project.query()
      .where('id', project.id)
      .update({ updated_at: DateTime.now().minus({ days: overrides.ageDays }).toSQL() })
    await project.refresh()
  }

  return project
}

async function addSlicedFile(project: Project) {
  const fileUuid = string.uuid()
  const fileStorageKey = `projects/${project.uuid}/${fileUuid}.stl`
  const gcodeKey = `projects/${project.uuid}/${fileUuid}.gcode`
  const variantKey = `projects/${project.uuid}/${fileUuid}_infill_probe.gcode`

  const disk = drive.use('s3')
  await disk.put(fileStorageKey, 'solid cube')
  await disk.put(gcodeKey, 'G1')
  await disk.put(variantKey, 'G1')

  const projectFile = await ProjectFile.create({
    uuid: fileUuid,
    projectId: project.id,
    technology: 'fdm',
    fileStorageKey,
    gcodeStorageKey: gcodeKey,
    originalName: 'cube.stl',
    mimeType: 'model/stl',
    fileSize: 1024,
    status: 'completed',
  })

  await projectFile.related('sliceVariants').createMany([
    {
      variant: 'baseline',
      infill: 15,
      layerHeight: 0.2,
      filamentUsedGrams: 60,
      printTimeEstimatedSeconds: 7200,
      gcodeStorageKey: gcodeKey,
    },
    {
      variant: 'infill_probe',
      infill: 100,
      layerHeight: 0.2,
      filamentUsedGrams: 120,
      printTimeEstimatedSeconds: 10800,
      gcodeStorageKey: variantKey,
    },
  ])

  return { projectFile, fileStorageKey, storageKeys: [fileStorageKey, gcodeKey, variantKey] }
}

async function addQuote(
  project: Project,
  projectFile: ProjectFile | null,
  status: 'draft' | 'sent' | 'accepted' | 'rejected' = 'draft'
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

  if (projectFile) {
    await quote.related('items').create({
      projectFileId: projectFile.id,
      itemType: 'printing',
      description: projectFile.originalName,
      quantity: 1,
      unitPrice: '23.45',
      total: '23.45',
      pricingSnapshot: { calculation: { finalPriceRounded: 23.45 } },
    })
  }

  return quote
}

test.group('Projects | expiring abandoned instant quotes', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    drive.fake('s3')
    return async () => {
      drive.restore()
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('expires an instant-quote project nobody came back to', async ({ assert }) => {
    const project = await createProject({ ageDays: 45 })

    await runJob(ExpireAbandonedProjects)

    await project.refresh()
    assert.equal(project.status, 'expired')
    assert.isNotNull(project.expiredAt)
  })

  test('expires a project whose email was captured', async ({ assert }) => {
    // The bug this fixes: keying on customer_id would exempt every captured
    // lead from cleanup forever, even though they never came back.
    const customer = await Customer.create({ uuid: string.uuid(), email: 'lead@example.com' })
    const project = await createProject({ ageDays: 45, customerId: customer.id })

    await runJob(ExpireAbandonedProjects)

    await project.refresh()
    assert.equal(project.status, 'expired')
  })

  test('marks open quotes rejected as abandoned', async ({ assert }) => {
    const project = await createProject({ ageDays: 45 })
    const { projectFile } = await addSlicedFile(project)
    const quote = await addQuote(project, projectFile, 'draft')

    await runJob(ExpireAbandonedProjects)

    await quote.refresh()
    assert.equal(quote.status, 'rejected')
    assert.equal(quote.rejectionReason, 'abandoned')
    assert.isNotNull(quote.rejectedAt)
  })

  test('leaves an accepted quote alone', async ({ assert }) => {
    const project = await createProject({ ageDays: 45 })
    const { projectFile } = await addSlicedFile(project)
    const accepted = await addQuote(project, projectFile, 'accepted')

    await runJob(ExpireAbandonedProjects)

    await accepted.refresh()
    assert.equal(accepted.status, 'accepted')
    assert.isNull(accepted.rejectionReason)
  })

  test('skips manual sales projects', async ({ assert }) => {
    const project = await createProject({ ageDays: 45, source: 'manual' })

    await runJob(ExpireAbandonedProjects)

    await project.refresh()
    assert.equal(project.status, 'draft')
  })

  test('skips recently active projects', async ({ assert }) => {
    const project = await createProject({ ageDays: 2 })

    await runJob(ExpireAbandonedProjects)

    await project.refresh()
    assert.equal(project.status, 'draft')
  })

  test('skips a project with checkout underway', async ({ assert }) => {
    const project = await createProject({ ageDays: 45 })
    await CheckoutSession.create({ projectId: project.id, status: 'active' })

    await runJob(ExpireAbandonedProjects)

    await project.refresh()
    assert.equal(project.status, 'draft')
  })

  test('is a no-op on a second run', async ({ assert }) => {
    const project = await createProject({ ageDays: 45 })

    await runJob(ExpireAbandonedProjects)
    await project.refresh()
    const firstExpiredAt = project.expiredAt

    await runJob(ExpireAbandonedProjects)
    await project.refresh()

    assert.equal(project.expiredAt?.toISO(), firstExpiredAt?.toISO())
  })
})

test.group('Projects | purging expired projects', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    drive.fake('s3')
    return async () => {
      drive.restore()
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('deletes storage and file rows but keeps the funnel record', async ({ assert }) => {
    const project = await createProject({ status: 'expired', expiredDaysAgo: 30 })
    const { projectFile, storageKeys } = await addSlicedFile(project)
    const quote = await addQuote(project, projectFile, 'rejected')

    await runJob(PurgeExpiredProjects)

    // Storage and file rows are gone.
    for (const key of storageKeys) {
      assert.isFalse(await drive.use('s3').exists(key), `${key} should be deleted`)
    }
    assert.lengthOf(await ProjectFile.all(), 0)

    // The paper trail survives - this is what makes the funnel analysable.
    await project.refresh()
    assert.equal(project.status, 'expired')
    await quote.refresh()
    assert.equal(quote.status, 'rejected')
    assert.equal(Number(quote.total), 23.45)
  })

  test('quote items survive with their pricing snapshot', async ({ assert }) => {
    const project = await createProject({ status: 'expired', expiredDaysAgo: 30 })
    const { projectFile } = await addSlicedFile(project)
    await addQuote(project, projectFile, 'rejected')

    await runJob(PurgeExpiredProjects)

    const items = await QuoteItem.all()
    assert.lengthOf(items, 1)
    // project_file_id is SET NULL, so the line survives the file it described.
    assert.isNull(items[0].projectFileId)
    assert.equal(items[0].pricingSnapshot.calculation.finalPriceRounded, 23.45)
  })

  test('records what it removed', async ({ assert }) => {
    const project = await createProject({ status: 'expired', expiredDaysAgo: 30 })
    await addSlicedFile(project)

    await runJob(PurgeExpiredProjects)

    const events = await AuditEvent.all()
    assert.lengthOf(events, 1)
    assert.equal(events[0].entityType, 'project')
    assert.equal(events[0].eventType, 'deleted')
    assert.deepInclude(events[0].payload, {
      reason: 'purged_expired_project_storage',
      projectUuid: project.uuid,
      fileCount: 1,
      deletedObjects: 3,
    })
  })

  test('leaves projects inside the grace window alone', async ({ assert }) => {
    const project = await createProject({ status: 'expired', expiredDaysAgo: 2 })
    const { storageKeys } = await addSlicedFile(project)

    await runJob(PurgeExpiredProjects)

    assert.lengthOf(await ProjectFile.all(), 1)
    for (const key of storageKeys) {
      assert.isTrue(await drive.use('s3').exists(key))
    }
  })

  test('leaves projects that are not expired alone', async ({ assert }) => {
    const project = await createProject({ status: 'draft' })
    await addSlicedFile(project)

    await runJob(PurgeExpiredProjects)

    assert.lengthOf(await ProjectFile.all(), 1)
  })

  test('a second run is a no-op and does not double count', async ({ assert }) => {
    const project = await createProject({ status: 'expired', expiredDaysAgo: 30 })
    await addSlicedFile(project)

    await runJob(PurgeExpiredProjects)
    await runJob(PurgeExpiredProjects)

    assert.lengthOf(await ProjectFile.all(), 0)
    // One purge, one audit row - re-running must not inflate the analytics.
    assert.lengthOf(await AuditEvent.all(), 1)
  })
})
