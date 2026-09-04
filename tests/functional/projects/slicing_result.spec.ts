import { createHmac } from 'node:crypto'
import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Customer from '#models/customer'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import ProjectFileSliceVariant from '#models/project_file_slice_variant'
import env from '#start/env'

function sign(payload: Record<string, unknown>) {
  const rawBody = JSON.stringify(payload)
  return createHmac('sha256', env.get('SLICER_CALLBACK_SECRET')).update(rawBody).digest('hex')
}

async function createPendingProjectFile(technology?: 'fdm' | 'sla' | 'sls') {
  const customer = await Customer.create({ uuid: string.uuid() })
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer.id,
    status: 'draft',
  })
  return ProjectFile.create({
    uuid: string.uuid(),
    projectId: project.id,
    fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
    originalName: 'cube.stl',
    mimeType: 'model/stl',
    fileSize: 1024,
    status: 'pending',
    ...(technology ? { technology } : {}),
  })
}

function buildVariants(overrides: { filamentUsedGrams?: number } = {}) {
  return [
    {
      variant: 'baseline' as const,
      infill: 20,
      layerHeight: 0.2,
      filamentUsedGrams: overrides.filamentUsedGrams ?? 5,
      printTimeEstimatedSeconds: 1800,
      gcodeStorageKey: 'projects/foo/bar.gcode',
    },
    {
      variant: 'infill_probe' as const,
      infill: 100,
      layerHeight: 0.2,
      filamentUsedGrams: overrides.filamentUsedGrams ?? 12,
      printTimeEstimatedSeconds: 2400,
      gcodeStorageKey: 'projects/foo/bar_infill_probe.gcode',
    },
    {
      variant: 'layer_height_probe' as const,
      infill: 20,
      layerHeight: 0.1,
      filamentUsedGrams: overrides.filamentUsedGrams ?? 5,
      printTimeEstimatedSeconds: 3200,
      gcodeStorageKey: 'projects/foo/bar_layer_height_probe.gcode',
    },
  ]
}

function buildSlaVariants() {
  return [
    {
      variant: 'baseline' as const,
      layerHeight: 0.05,
      filamentUsedGrams: 33.77,
      printTimeEstimatedSeconds: 6199,
      gcodeStorageKey: 'projects/foo/bar.sl1',
    },
    {
      variant: 'layer_height_probe' as const,
      layerHeight: 0.025,
      filamentUsedGrams: 33.89,
      printTimeEstimatedSeconds: 12111,
      gcodeStorageKey: 'projects/foo/bar_layer_height_probe.sl1',
    },
  ]
}

test.group('Projects | slicing result callback', (group) => {
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
    const projectFile = await createPendingProjectFile()
    const payload = {
      status: 'completed' as const,
      gcodeStorageKey: 'projects/foo/bar.gcode',
      volume: 12.5,
      x: 1,
      y: 2,
      z: 3,
    }

    const missingSignature = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .json(payload)
    missingSignature.assertStatus(401)

    const invalidSignature = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', 'not-the-right-signature')
      .json(payload)
    invalidSignature.assertStatus(401)

    await projectFile.refresh()
    assert.equal(projectFile.status, 'pending')
  })

  test('marks a project file completed with gcode results', async ({ client, assert }) => {
    const projectFile = await createPendingProjectFile()
    const payload = {
      status: 'completed' as const,
      gcodeStorageKey: 'projects/foo/bar.gcode',
      volume: 12.5,
      x: 10,
      y: 20,
      z: 30,
      infill: 20,
      layerHeight: 0.2,
      supportMaterialGrams: 2.5,
      modelMaterialGrams: 6.99,
      printTimeEstimatedSeconds: 1800,
    }

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)
    response.assertBodyContains({ data: { status: 'completed' } })

    await projectFile.refresh()
    assert.equal(projectFile.status, 'completed')
    assert.equal(projectFile.gcodeStorageKey, payload.gcodeStorageKey)
    assert.equal(projectFile.volume, payload.volume)
    assert.equal(projectFile.x, payload.x)
    assert.equal(projectFile.infill, payload.infill)
    assert.equal(projectFile.layerHeight, payload.layerHeight)
    assert.equal(projectFile.supportMaterialGrams, payload.supportMaterialGrams)
    assert.equal(projectFile.modelMaterialGrams, payload.modelMaterialGrams)
    assert.equal(projectFile.printTimeEstimatedSeconds, payload.printTimeEstimatedSeconds)
  })

  test('accepts an SLS callback with surfaceAreaMm2 and no gcode', async ({ client, assert }) => {
    const projectFile = await createPendingProjectFile('sls')
    const payload = {
      status: 'completed' as const,
      volume: 12.5,
      x: 10,
      y: 20,
      z: 30,
      surfaceAreaMm2: 850.5,
      printTimeEstimatedSeconds: 5080,
    }

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)

    await projectFile.refresh()
    assert.equal(projectFile.status, 'completed')
    assert.isNull(projectFile.gcodeStorageKey)
    assert.equal(projectFile.volume, payload.volume)
    assert.equal(projectFile.surfaceAreaMm2, payload.surfaceAreaMm2)
    assert.equal(projectFile.printTimeEstimatedSeconds, payload.printTimeEstimatedSeconds)
  })

  test('rejects an SLS callback missing surfaceAreaMm2', async ({ client, assert }) => {
    const projectFile = await createPendingProjectFile('sls')
    const payload = {
      status: 'completed' as const,
      volume: 12.5,
      x: 10,
      y: 20,
      z: 30,
    }

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(400)

    await projectFile.refresh()
    assert.equal(projectFile.status, 'pending')
  })

  test('marks a project file failed on slicing failure', async ({ client, assert }) => {
    const projectFile = await createPendingProjectFile()
    const payload = { status: 'failed' as const, error: 'unsupported geometry' }

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)
    response.assertBodyContains({ data: { status: 'failed' } })

    await projectFile.refresh()
    assert.equal(projectFile.status, 'failed')
    assert.isNull(projectFile.gcodeStorageKey)
  })

  test('returns 404 for an unknown project file uuid', async ({ client }) => {
    const payload = { status: 'failed' as const, error: 'unsupported geometry' }

    const response = await client
      .patch(`/v1/projects/files/${string.uuid()}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(404)
  })

  test('stores 3 variant rows on completion', async ({ client, assert }) => {
    const projectFile = await createPendingProjectFile()
    const payload = {
      status: 'completed' as const,
      gcodeStorageKey: 'projects/foo/bar.gcode',
      volume: 12.5,
      x: 10,
      y: 20,
      z: 30,
      variants: buildVariants(),
    }

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)

    const variants = await ProjectFileSliceVariant.query()
      .where('projectFileId', projectFile.id)
      .orderBy('variant')
    assert.lengthOf(variants, 3)
    assert.equal(variants[0].variant, 'baseline')
    assert.equal(variants[0].infill, 20)
    assert.equal(variants[0].layerHeight, 0.2)
    assert.equal(variants[0].filamentUsedGrams, 5)
    assert.equal(variants[0].printTimeEstimatedSeconds, 1800)
    assert.equal(variants[0].gcodeStorageKey, 'projects/foo/bar.gcode')
  })

  test('accepts an SLA-shaped variants payload with no infill on either variant', async ({
    client,
    assert,
  }) => {
    const projectFile = await createPendingProjectFile()
    const payload = {
      status: 'completed' as const,
      gcodeStorageKey: 'projects/foo/bar.sl1',
      volume: 27,
      x: 30,
      y: 30,
      z: 30,
      layerHeight: 0.05,
      printTimeEstimatedSeconds: 6199,
      variants: buildSlaVariants(),
    }

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)

    await projectFile.refresh()
    assert.isNull(projectFile.infill)
    assert.equal(projectFile.layerHeight, 0.05)

    const variants = await ProjectFileSliceVariant.query()
      .where('projectFileId', projectFile.id)
      .orderBy('variant')
    assert.lengthOf(variants, 2)
    for (const variant of variants) {
      assert.isNull(variant.infill)
    }
  })

  test('rejects a variants array with an unknown variant name', async ({ client }) => {
    const projectFile = await createPendingProjectFile()
    const payload = {
      status: 'completed' as const,
      gcodeStorageKey: 'projects/foo/bar.gcode',
      volume: 12.5,
      x: 10,
      y: 20,
      z: 30,
      variants: [
        {
          variant: 'not_a_real_variant',
          layerHeight: 0.2,
          filamentUsedGrams: 5,
          printTimeEstimatedSeconds: 1800,
          gcodeStorageKey: 'projects/foo/bar.gcode',
        },
      ],
    } as any

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(422)
  })

  test('is idempotent when the same variants payload is delivered twice', async ({
    client,
    assert,
  }) => {
    const projectFile = await createPendingProjectFile()
    const payload = {
      status: 'completed' as const,
      gcodeStorageKey: 'projects/foo/bar.gcode',
      volume: 12.5,
      x: 10,
      y: 20,
      z: 30,
      variants: buildVariants(),
    }
    const signature = sign(payload)

    await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', signature)
      .json(payload)
    await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', signature)
      .json(payload)

    const variants = await ProjectFileSliceVariant.query().where('projectFileId', projectFile.id)
    assert.lengthOf(variants, 3)
  })

  test('upserts variant rows in place when values change on retry', async ({ client, assert }) => {
    const projectFile = await createPendingProjectFile()
    const firstPayload = {
      status: 'completed' as const,
      gcodeStorageKey: 'projects/foo/bar.gcode',
      volume: 12.5,
      x: 10,
      y: 20,
      z: 30,
      variants: buildVariants({ filamentUsedGrams: 5 }),
    }
    const secondPayload = {
      ...firstPayload,
      variants: buildVariants({ filamentUsedGrams: 7 }),
    }

    await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(firstPayload))
      .json(firstPayload)
    await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(secondPayload))
      .json(secondPayload)

    const variants = await ProjectFileSliceVariant.query().where('projectFileId', projectFile.id)
    assert.lengthOf(variants, 3)
    for (const variant of variants) {
      assert.equal(variant.filamentUsedGrams, 7)
    }
  })

  test('omitting variants keeps the flat-payload behavior and creates no rows', async ({
    client,
    assert,
  }) => {
    const projectFile = await createPendingProjectFile()
    const payload = {
      status: 'completed' as const,
      gcodeStorageKey: 'projects/foo/bar.gcode',
      volume: 12.5,
      x: 10,
      y: 20,
      z: 30,
    }

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)
    await projectFile.refresh()
    assert.equal(projectFile.status, 'completed')

    const variants = await ProjectFileSliceVariant.query().where('projectFileId', projectFile.id)
    assert.lengthOf(variants, 0)
  })

  test('rejects a variants array with a missing field or duplicate variant names', async ({
    client,
  }) => {
    const projectFile = await createPendingProjectFile()
    const basePayload = {
      status: 'completed' as const,
      gcodeStorageKey: 'projects/foo/bar.gcode',
      volume: 12.5,
      x: 10,
      y: 20,
      z: 30,
    }

    // Deliberately malformed, so it is cast past the request payload type - the
    // point of the test is that validation rejects it at runtime.
    const missingField = {
      ...basePayload,
      variants: [
        {
          variant: 'baseline',
          infill: 20,
          layerHeight: 0.2,
          // filamentUsedGrams intentionally omitted
          printTimeEstimatedSeconds: 1800,
          gcodeStorageKey: 'projects/foo/bar.gcode',
        },
      ],
    } as any
    const missingFieldResponse = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(missingField))
      .json(missingField)
    missingFieldResponse.assertStatus(422)

    const duplicateVariant = {
      ...basePayload,
      variants: [buildVariants()[0], { ...buildVariants()[0] }],
    }
    const duplicateVariantResponse = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(duplicateVariant))
      .json(duplicateVariant)
    duplicateVariantResponse.assertStatus(422)
  })

  test('a failed status ignores any variants in the payload', async ({ client, assert }) => {
    const projectFile = await createPendingProjectFile()
    const payload = {
      status: 'failed' as const,
      error: 'unsupported geometry',
      variants: buildVariants(),
    }

    const response = await client
      .patch(`/v1/projects/files/${projectFile.uuid}/slicing-result`)
      .header('x-slicer-signature', sign(payload))
      .json(payload)

    response.assertStatus(200)
    await projectFile.refresh()
    assert.equal(projectFile.status, 'failed')

    const variants = await ProjectFileSliceVariant.query().where('projectFileId', projectFile.id)
    assert.lengthOf(variants, 0)
  })
})
