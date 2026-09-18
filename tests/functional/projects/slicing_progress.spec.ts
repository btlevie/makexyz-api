import { createHmac } from 'node:crypto'
import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import transmit from '@adonisjs/transmit/services/main'
import Customer from '#models/customer'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import { issueGrant } from '#services/project_grant_service'
import env from '#start/env'

function sign(payload: Record<string, unknown>) {
  const rawBody = JSON.stringify(payload)
  return createHmac('sha256', env.get('SLICER_CALLBACK_SECRET')).update(rawBody).digest('hex')
}

async function createPendingProjectFile(status: 'pending' | 'processing' | 'completed' = 'pending') {
  const customer = await Customer.create({ uuid: string.uuid() })
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer.id,
    status: 'draft',
  })
  const projectFile = await ProjectFile.create({
    uuid: string.uuid(),
    projectId: project.id,
    fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
    originalName: 'cube.stl',
    mimeType: 'model/stl',
    fileSize: 1024,
    status,
  })
  return { project, projectFile, grant: issueGrant(project) }
}

test.group('Projects | slicing progress callback', (group) => {
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

  test('rejects requests with a missing or invalid signature', async ({ client, assert }) => {
    const { projectFile } = await createPendingProjectFile()
    const payload = { stage: 'prepared', percent: 10 }

    const missingSignature = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-progress`)
      .json(payload)
    missingSignature.assertStatus(401)

    const invalidSignature = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-progress`)
      .header('x-slicer-signature', 'not-the-right-signature')
      .json(payload)
    invalidSignature.assertStatus(401)

    await projectFile.refresh()
    assert.equal(projectFile.status, 'pending')
  })

  test('returns 404 for an unknown project file uuid', async ({ client }) => {
    const payload = { stage: 'prepared', percent: 10 }

    const response = await client
      .patch(`/v1/projects/files/${string.uuid()}/slicing-progress`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(404)
  })

  test('rejects a missing stage or an out-of-range percent', async ({ client }) => {
    const { projectFile } = await createPendingProjectFile()

    const missingStage = { percent: 10 } as any
    const missingStageResponse = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-progress`)
      .header('x-slicer-signature', sign(missingStage))
      .json(missingStage)
    missingStageResponse.assertStatus(422)

    const outOfRange = { stage: 'prepared', percent: 150 }
    const outOfRangeResponse = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-progress`)
      .header('x-slicer-signature', sign(outOfRange))
      .json(outOfRange)
    outOfRangeResponse.assertStatus(422)
  })

  test('flips a pending file to processing and persists percent/stage', async ({
    client,
    assert,
  }) => {
    const { projectFile } = await createPendingProjectFile()
    const payload = { stage: 'prepared', percent: 10 }

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-progress`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)
    response.assertBodyContains({ data: { status: 'processing' } })

    await projectFile.refresh()
    assert.equal(projectFile.status, 'processing')
    assert.equal(projectFile.slicingProgressPercent, 10)
    assert.equal(projectFile.slicingProgressStage, 'prepared')
  })

  test('does not move status backwards once already completed', async ({ client, assert }) => {
    const { projectFile } = await createPendingProjectFile('completed')
    const payload = { stage: 'sliced_baseline', percent: 90 }

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-progress`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)
    response.assertBodyContains({ data: { status: 'completed' } })

    await projectFile.refresh()
    assert.equal(projectFile.status, 'completed')
    // Still records the ping, even though status itself doesn't move.
    assert.equal(projectFile.slicingProgressPercent, 90)
  })

  test('broadcasts a progress event on the project channel', async ({ client, assert }) => {
    const { project, projectFile } = await createPendingProjectFile()
    const payload = { stage: 'prepared', percent: 10 }

    const broadcasts: { channel: string; payload: unknown }[] = []
    const stopListening = transmit.on('broadcast', (event) => broadcasts.push(event))

    await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-progress`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    stopListening()

    assert.lengthOf(broadcasts, 1)
    assert.equal(broadcasts[0].channel, `projects/${project.uuid}/progress`)
    assert.deepEqual(broadcasts[0].payload, {
      fileUuid: projectFile.uuid,
      status: 'processing',
      stage: 'prepared',
      percent: 10,
    })
  })

  test('the terminal slicing-result callback also broadcasts on the same channel', async ({
    client,
    assert,
  }) => {
    const { project, projectFile } = await createPendingProjectFile()
    const payload = {
      status: 'completed' as const,
      gcodeStorageKey: 'projects/foo/bar.gcode',
      volume: 12.5,
      x: 10,
      y: 20,
      z: 30,
    }

    const broadcasts: { channel: string; payload: unknown }[] = []
    const stopListening = transmit.on('broadcast', (event) => broadcasts.push(event))

    await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    stopListening()

    assert.lengthOf(broadcasts, 1)
    assert.equal(broadcasts[0].channel, `projects/${project.uuid}/progress`)
    assert.deepEqual(broadcasts[0].payload, { fileUuid: projectFile.uuid, status: 'completed' })
  })
})

test.group('Projects | project file lookup (reconnect recovery)', (group) => {
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

  test('returns current status and progress for the grant holder', async ({ client, assert }) => {
    const { projectFile, grant } = await createPendingProjectFile('processing')
    projectFile.slicingProgressPercent = 65
    projectFile.slicingProgressStage = 'sliced_infill_probe'
    await projectFile.save()

    const response = await client
      .get(`/v1/projects/files/${projectFile.uuid}`)
      .header('x-project-grant', grant)

    response.assertStatus(200)
    // The GET/PATCH routes under /v1/projects/files/:uuid share one pattern,
    // so Tuyau's client typing unions their response shapes here - cast to
    // the shape this specific endpoint actually returns.
    const data = response.body().data as {
      status: string
      slicingProgressPercent: number | null
      slicingProgressStage: string | null
    }
    assert.equal(data.status, 'processing')
    assert.equal(data.slicingProgressPercent, 65)
    assert.equal(data.slicingProgressStage, 'sliced_infill_probe')
  })

  test('returns 404 without a grant for another project', async ({ client }) => {
    const { projectFile } = await createPendingProjectFile()

    const response = await client.get(`/v1/projects/files/${projectFile.uuid}`)

    response.assertStatus(404)
  })

  test('returns 404 for an unknown project file uuid', async ({ client }) => {
    const response = await client.get(`/v1/projects/files/${string.uuid()}`)

    response.assertStatus(404)
  })
})
