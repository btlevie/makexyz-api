import string from '@adonisjs/core/helpers/string'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import Customer from '#models/customer'
import Project from '#models/project'
import { uploadProjectFileValidator, sliceResultValidator } from '#validators/project_file'
import InstantQuoteFileTransformer from '#transformers/instant_quote_file_transformer'
import env from '#start/env'
import ProjectFile from '#models/project_file'
import Material from '#models/material'
import { enqueueSlicingJob } from '#services/sqs_service'

export default class ProjectFilesController {
  async store({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { files, projectUuid } = await request.validateUsing(uploadProjectFileValidator)

    const customer = await Customer.firstOrCreate(
      { userId: user.id },
      { userId: user.id, uuid: string.uuid() }
    )

    let project: Project

    if (!projectUuid) {
      project = await Project.create({
        uuid: string.uuid(),
        customerId: customer.id,
        status: 'draft',
      })
    } else {
      project = await Project.findByOrFail('uuid', projectUuid)
    }

    const material = await Material.firstOrCreate({ name: 'PLA' })

    for (const entry of files) {
      const file = entry
      const fileUuid = string.uuid()
      const storageKey = `${env.get('S3_FILE_STORAGE_KEY')}/${project.uuid}/${fileUuid}.${file.extname}`
      await file.moveToDisk(storageKey)
      const projectFile = await ProjectFile.create({
        projectId: project.id,
        uuid: fileUuid,
        fileStorageKey: storageKey,
        originalName: file.clientName,
        mimeType: file.type ?? 'application/octet-stream',
        fileSize: file.size,
        materialId: material.id,
        status: 'pending',
      })
      await enqueueSlicingJob(projectFile, material.name)
    }

    return await serialize(InstantQuoteFileTransformer.transform(project))
  }

  async updateSlicingResult({ params, request, response, serialize }: HttpContext) {
    const payload = await request.validateUsing(sliceResultValidator)

    const projectFile = await ProjectFile.findBy('uuid', params.uuid)
    if (!projectFile) {
      return response.notFound({ error: 'Project file not found' })
    }

    if (payload.status === 'completed') {
      if (
        payload.gcodeStorageKey === undefined ||
        payload.volume === undefined ||
        payload.x === undefined ||
        payload.y === undefined ||
        payload.z === undefined
      ) {
        return response.badRequest({ error: 'Missing slicing result fields' })
      }
      projectFile.gcodeStorageKey = payload.gcodeStorageKey
      projectFile.volume = payload.volume
      projectFile.x = payload.x
      projectFile.y = payload.y
      projectFile.z = payload.z
      if (payload.infill !== undefined) {
        projectFile.infill = payload.infill
      }
      if (payload.layerHeight !== undefined) {
        projectFile.layerHeight = payload.layerHeight
      }
      if (payload.supportMaterialGrams !== undefined) {
        projectFile.supportMaterialGrams = payload.supportMaterialGrams
      }
      if (payload.modelMaterialGrams !== undefined) {
        projectFile.modelMaterialGrams = payload.modelMaterialGrams
      }
      if (payload.printTimeEstimatedSeconds !== undefined) {
        projectFile.printTimeEstimatedSeconds = payload.printTimeEstimatedSeconds
      }
      projectFile.status = 'completed'

      if (payload.variants && payload.variants.length > 0) {
        // updateOrCreateMany saves projectFile itself as part of the same managed
        // transaction, so no separate .save() call in this branch. Matching on
        // 'variant' (scoped to this projectFile via the relation's foreign key)
        // makes SQS at-least-once redelivery idempotent: a retry with the same
        // values updates rows in place instead of duplicating them.
        await projectFile.related('sliceVariants').updateOrCreateMany(
          payload.variants.map((variant) => ({
            variant: variant.variant,
            infill: variant.infill,
            layerHeight: variant.layerHeight,
            filamentUsedGrams: variant.filamentUsedGrams,
            printTimeEstimatedSeconds: variant.printTimeEstimatedSeconds,
            gcodeStorageKey: variant.gcodeStorageKey,
          })),
          'variant'
        )
      } else {
        await projectFile.save()
      }
    } else {
      if (payload.error === undefined) {
        return response.badRequest({ error: 'Missing failure reason' })
      }
      logger.warn(
        { projectFileUuid: projectFile.uuid, error: payload.error },
        'Slicing failed for project file'
      )
      projectFile.status = 'failed'
      await projectFile.save()
    }

    return serialize({ uuid: projectFile.uuid, status: projectFile.status })
  }
}
