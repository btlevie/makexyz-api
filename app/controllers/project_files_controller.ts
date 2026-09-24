import string from '@adonisjs/core/helpers/string'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import drive from '@adonisjs/drive/services/main'
import db from '@adonisjs/lucid/services/db'
import transmit from '@adonisjs/transmit/services/main'
import Customer from '#models/customer'
import Project from '#models/project'
import {
  uploadProjectFileValidator,
  sliceResultValidator,
  slicingProgressValidator,
  updateProjectFileTechnologyValidator,
  updateProjectFileMaterialValidator,
  updateProjectFileColorValidator,
} from '#validators/project_file'
import InstantQuoteFileTransformer from '#transformers/instant_quote_file_transformer'
import ProjectFileTransformer from '#transformers/project_file_transformer'
import env from '#start/env'
import AuditEvent from '#models/audit_event'
import ProjectFile from '#models/project_file'
import { enqueueSlicingJob } from '#services/sqs_service'
import {
  isStaff,
  issueGrant,
  resolveProject,
  resolveProjectFile,
} from '#services/project_grant_service'
import { autoQuoteProjectIfReady } from '#services/auto_quote_service'
import { findTechnologyLock } from '#services/technology_lock_service'
import {
  PayoutRateMissingError,
  recalculatePendingPayoutsForProjectFile,
} from '#services/payout_calculation_service'
import {
  findColorByUuid,
  findMaterialByUuid,
  resolveColorForMaterialChange,
  resolveDefaultColor,
  resolveDefaultMaterial,
} from '#services/material_service'

export default class ProjectFilesController {
  /**
   * The public instant-quote entry point: upload models, get a price, no account
   * required. Deliberately not called `store` - a separate flow for uploading
   * into a manually created project is coming
   * (`POST /v1/projects/:projectUuid/files`), and the two must stay
   * distinguishable.
   *
   * Anonymous callers get an unowned project plus a signed grant, which is what
   * authorizes their follow-up requests. A customer is attached later, and only
   * if they opt into having the quote emailed.
   */
  async storeInstantQuoteFiles(ctx: HttpContext) {
    const { auth, request, response, serialize } = ctx
    const {
      files,
      projectUuid,
      technology: requestedTechnology,
    } = await request.validateUsing(uploadProjectFileValidator)
    const technology = requestedTechnology ?? 'fdm'

    // Populated-or-null by the global SilentAuthMiddleware; this route is public.
    const user = auth.user
    const customer = user
      ? await Customer.firstOrCreate({ userId: user.id }, { userId: user.id, uuid: string.uuid() })
      : null

    let project: Project

    if (!projectUuid) {
      project = await Project.create({
        uuid: string.uuid(),
        customerId: customer?.id ?? null,
        status: 'draft',
        // Explicit rather than leaning on the column default, so the manual
        // flow's 'manual' reads as a deliberate counterpart.
        source: 'instant_quote',
      })
    } else {
      // Previously findByOrFail with no ownership check - a cross-tenant write
      // under auth, and anonymous write-to-any-project now the route is public.
      const existing = await resolveProject(ctx, projectUuid)
      if (!existing) {
        return response.notFound({ error: 'Project not found' })
      }
      project = existing
    }

    const material = await resolveDefaultMaterial(technology)
    const color = resolveDefaultColor(material)

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
        colorId: color.id,
        technology,
        status: 'pending',
      })

      await enqueueSlicingJob(projectFile, technology, material.name)
    }

    // Only anonymous callers need a grant; an authenticated owner is already
    // authorized through their Customer.
    return await serialize(
      InstantQuoteFileTransformer.transform(project, customer ? null : issueGrant(project))
    )
  }

  /**
   * Switches a project file between manufacturing technologies and re-queues it
   * for slicing.
   *
   * Slice results are technology-specific, so they are discarded rather than
   * carried over: SLA sends no infill and no support/model split, and
   * updateSlicingResult only ever assigns fields it receives - so without a
   * reset, FDM numbers would survive under an SLA label and feed pricing.
   * Dimensions go too, because SLA slices unoriented (the slicer skips Tweaker-3)
   * and can legitimately report a different bounding box for the same geometry.
   *
   * Once a part has been quoted to the customer it is locked (see
   * QUOTE_STATUSES_LOCKING_TECHNOLOGY): the quote itself is an immutable snapshot
   * and cannot be corrupted, but letting the part change underneath an
   * outstanding quote would mean the customer accepts one thing and receives
   * another. Staff can override to correct a mistake, which is recorded - except
   * once the order is already in production (see technology_lock_service.ts's
   * `overridable` field), where a technology change is a new order, not a
   * correction, and nobody can override it.
   */
  async updateTechnology(ctx: HttpContext) {
    const { auth, params, request, response, serialize } = ctx
    const { technology } = await request.validateUsing(updateProjectFileTechnologyValidator)

    // Anonymous instant-quote visitors authorize with their project grant; there
    // may be no user at all. 404 rather than 403 for someone else's file - no
    // reason to confirm it exists.
    const projectFile = await resolveProjectFile(ctx, params.uuid)
    if (!projectFile) {
      return response.notFound({ error: 'Project file not found' })
    }

    // A redundant call must not throw away slice data that is still valid - and
    // needs no override, since nothing actually changes.
    if (projectFile.technology === technology) {
      return await serialize(ProjectFileTransformer.transform(projectFile))
    }

    const lock = await findTechnologyLock(projectFile)
    // Staff may override a checkout/quote lock to correct a mistake, but
    // never an order already in production (lock.overridable === false) -
    // past that point a technology change is a new order, not a correction.
    const canOverrideLock = isStaff(ctx) && lock?.overridable !== false

    if (lock && !canOverrideLock) {
      return response.conflict({
        error: `Project file ${projectFile.uuid} can no longer change technology because ${lock.description}`,
      })
    }

    // Collect output keys before the rows holding them are deleted. Never the
    // uploaded source model, which lives under the same project prefix - that is
    // also why these are deleted key by key rather than by prefix.
    const staleOutputKeys = new Set<string>()
    for (const key of [
      projectFile.gcodeStorageKey,
      ...projectFile.sliceVariants.map((variant) => variant.gcodeStorageKey),
    ]) {
      if (key && key !== projectFile.fileStorageKey) {
        staleOutputKeys.add(key)
      }
    }

    const material = await resolveDefaultMaterial(technology)
    const color = resolveColorForMaterialChange(projectFile.color, material)
    const previousTechnology = projectFile.technology

    try {
      await db.transaction(async (trx) => {
        projectFile.useTransaction(trx)

        await projectFile.related('sliceVariants').query().delete()

        projectFile.gcodeStorageKey = null
        projectFile.volume = null
        projectFile.x = null
        projectFile.y = null
        projectFile.z = null
        projectFile.infill = null
        projectFile.layerHeight = null
        projectFile.supportMaterialGrams = null
        projectFile.modelMaterialGrams = null
        projectFile.printTimeEstimatedSeconds = null
        projectFile.surfaceAreaMm2 = null

        projectFile.technology = technology
        projectFile.materialId = material.id
        projectFile.colorId = color.id
        projectFile.status = 'pending'

        await projectFile.save()

        // An accepted order's vendor payout follows the part's material.
        await recalculatePendingPayoutsForProjectFile(projectFile.id, trx)

        // Only when a lock was actually overridden - an ordinary pre-checkout
        // change is not an exception worth recording. Overriding requires staff,
        // so auth.user is always present here.
        if (lock) {
          await AuditEvent.create(
            {
              entityType: 'project_file',
              entityId: projectFile.id,
              eventType: 'updated',
              userId: auth.user!.id,
              payload: {
                reason: 'technology_changed_after_lock',
                projectFileUuid: projectFile.uuid,
                from: previousTechnology,
                to: technology,
                overriddenByRole: auth.user!.role,
                lockReason: lock.reason,
                lockDescription: lock.description,
              },
            },
            { client: trx }
          )
        }
      })
    } catch (error) {
      if (error instanceof PayoutRateMissingError) {
        return response.unprocessableEntity({ error: error.message })
      }
      throw error
    }

    // Best effort, after the commit: orphaned S3 objects are a cleanup chore,
    // whereas failing here would leave the switch half-applied.
    for (const key of staleOutputKeys) {
      try {
        await drive.use('s3').delete(key)
      } catch (error) {
        logger.warn(
          { projectFileUuid: projectFile.uuid, storageKey: key, error: String(error) },
          'Failed to delete a stale slicer output after a technology change'
        )
      }
    }

    await enqueueSlicingJob(projectFile, technology, material.name)

    logger.info(
      {
        projectFileUuid: projectFile.uuid,
        from: previousTechnology,
        to: technology,
        deletedOutputs: staleOutputKeys.size,
        overrodeLock: lock ? lock.reason : null,
      },
      'Project file technology changed; re-queued for slicing'
    )

    // The FK changed but the preloaded relation object doesn't auto-refresh.
    projectFile.$setRelated('material', material)
    projectFile.$setRelated('color', color)
    return await serialize(ProjectFileTransformer.transform(projectFile))
  }

  /**
   * Switches a project file's material without re-slicing.
   *
   * Slicer-reported grams are density-dependent (the slicer is told which
   * filament profile to use, not just geometry), so a bare materialId swap
   * would leave grams computed for the old material's density. Rather than
   * force a re-slice, existing grams are rescaled by the new/old density
   * ratio when both are known - a real correction, not a heuristic. Materials
   * without a known density simply skip rescaling.
   *
   * Quote regeneration reuses autoQuoteProjectIfReady (same as the slicer
   * callback) rather than any new pricing code - status is never reset to
   * pending here, so a completed file stays completed and reprices
   * immediately.
   *
   * Locking mirrors updateTechnology: findTechnologyLock's predicate (active
   * checkout, or a sent/accepted quote) isn't actually technology-specific,
   * so it applies here unchanged.
   */
  async updateMaterial(ctx: HttpContext) {
    const { auth, params, request, response, serialize } = ctx
    const { materialUuid } = await request.validateUsing(updateProjectFileMaterialValidator)

    const projectFile = await resolveProjectFile(ctx, params.uuid)
    if (!projectFile) {
      return response.notFound({ error: 'Project file not found' })
    }

    const newMaterial = await findMaterialByUuid(materialUuid)
    if (!newMaterial) {
      return response.notFound({ error: `Material ${materialUuid} not found` })
    }
    if (newMaterial.technology !== projectFile.technology) {
      return response.unprocessableEntity({
        error: `Material ${materialUuid} is not a ${projectFile.technology} material`,
      })
    }

    // A redundant call must not need a lock override, since nothing changes.
    if (projectFile.materialId === newMaterial.id) {
      projectFile.$setRelated('material', newMaterial)
      return await serialize(ProjectFileTransformer.transform(projectFile))
    }

    const lock = await findTechnologyLock(projectFile)
    const canOverrideLock = isStaff(ctx)

    if (lock && !canOverrideLock) {
      return response.conflict({
        error: `Project file ${projectFile.uuid} can no longer change material because ${lock.description}`,
      })
    }

    const oldMaterial = projectFile.material
    const ratio =
      oldMaterial?.densityGPerCm3 && newMaterial.densityGPerCm3
        ? Number(newMaterial.densityGPerCm3) / Number(oldMaterial.densityGPerCm3)
        : null
    const color = resolveColorForMaterialChange(projectFile.color, newMaterial)

    try {
      await db.transaction(async (trx) => {
        projectFile.useTransaction(trx)

        if (ratio !== null && ratio !== 1) {
          if (projectFile.modelMaterialGrams !== null) {
            projectFile.modelMaterialGrams *= ratio
          }
          if (projectFile.supportMaterialGrams !== null) {
            projectFile.supportMaterialGrams *= ratio
          }
          await projectFile
            .related('sliceVariants')
            .query()
            .update({
              filament_used_grams: db.raw('filament_used_grams * ?', [ratio]),
            })
        }

        projectFile.materialId = newMaterial.id
        projectFile.colorId = color.id
        await projectFile.save()

        // An accepted order's vendor payout follows the part's material.
        await recalculatePendingPayoutsForProjectFile(projectFile.id, trx)

        // Only when a lock was actually overridden - an ordinary pre-checkout
        // change is not an exception worth recording. Overriding requires staff,
        // so auth.user is always present here.
        if (lock) {
          await AuditEvent.create(
            {
              entityType: 'project_file',
              entityId: projectFile.id,
              eventType: 'updated',
              userId: auth.user!.id,
              payload: {
                reason: 'material_changed_after_lock',
                projectFileUuid: projectFile.uuid,
                from: oldMaterial?.uuid ?? null,
                to: newMaterial.uuid,
                overriddenByRole: auth.user!.role,
                lockReason: lock.reason,
                lockDescription: lock.description,
              },
            },
            { client: trx }
          )
        }
      })
    } catch (error) {
      if (error instanceof PayoutRateMissingError) {
        return response.unprocessableEntity({ error: error.message })
      }
      throw error
    }

    projectFile.$setRelated('material', newMaterial)
    projectFile.$setRelated('color', color)
    await autoQuoteProjectIfReady(projectFile.projectId)

    return await serialize(ProjectFileTransformer.transform(projectFile))
  }

  /**
   * Switches a project file's color. No lock check, unlike technology/material -
   * color doesn't affect grams, density, or price, so there's no
   * financial-commitment reason to freeze it once a quote exists or checkout
   * starts.
   */
  async updateColor(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const { colorUuid } = await request.validateUsing(updateProjectFileColorValidator)

    const projectFile = await resolveProjectFile(ctx, params.uuid)
    if (!projectFile) {
      return response.notFound({ error: 'Project file not found' })
    }
    if (!projectFile.material) {
      return response.unprocessableEntity({
        error: `Project file ${projectFile.uuid} has no material assigned`,
      })
    }

    const chosen = findColorByUuid(projectFile.material, colorUuid)
    if (!chosen) {
      return response.unprocessableEntity({
        error: `Color ${colorUuid} is not available on material "${projectFile.material.name}"`,
      })
    }

    projectFile.colorId = chosen.id
    await projectFile.save()

    projectFile.$setRelated('color', chosen)
    return await serialize(ProjectFileTransformer.transform(projectFile))
  }

  /**
   * Read-only lookup for a single project file. Exists primarily so a client
   * that reconnects mid-slice (a backgrounded tab, a network blip) can recover
   * current status/progress with a plain GET - transmit doesn't buffer missed
   * events, so the live stream alone can't answer "what's the state right now".
   */
  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const projectFile = await resolveProjectFile(ctx, params.uuid)
    if (!projectFile) {
      return response.notFound({ error: 'Project file not found' })
    }

    return await serialize(ProjectFileTransformer.transform(projectFile))
  }

  /**
   * Best-effort progress callback from the slicer microservice - percentage
   * and stage only, no `error` field, since a fatal failure already goes
   * through updateSlicingResult's `status: 'failed'` path instead. Flips
   * status to 'processing' on the first progress update (previously that
   * transition never happened at all) and broadcasts to any subscribed
   * client so the frontend can move off polling.
   */
  async updateSlicingProgress({ params, request, response, serialize }: HttpContext) {
    const { stage, percent } = await request.validateUsing(slicingProgressValidator)

    const projectFile = await ProjectFile.query()
      .where('uuid', params.uuid)
      .preload('project')
      .first()
    if (!projectFile || !projectFile.project) {
      return response.notFound({ error: 'Project file not found' })
    }

    if (projectFile.status === 'pending') {
      projectFile.status = 'processing'
    }
    projectFile.slicingProgressPercent = percent
    projectFile.slicingProgressStage = stage
    await projectFile.save()

    transmit.broadcast(`projects/${projectFile.project.uuid}/progress`, {
      fileUuid: projectFile.uuid,
      status: projectFile.status,
      stage,
      percent,
    })

    return serialize({ uuid: projectFile.uuid, status: projectFile.status })
  }

  async updateSlicingResult({ params, request, response, serialize }: HttpContext) {
    const payload = await request.validateUsing(sliceResultValidator)

    const projectFile = await ProjectFile.query()
      .where('uuid', params.uuid)
      .preload('project')
      .first()
    if (!projectFile || !projectFile.project) {
      return response.notFound({ error: 'Project file not found' })
    }

    if (payload.status === 'completed') {
      // SLS has no G-code at all (no toolpath was ever generated) but does need
      // surfaceAreaMm2, which no other technology reports - see mesh_geometry.py
      // in the prusa-slicer repo.
      const requiresGcode = projectFile.technology !== 'sls'
      const requiresSurfaceArea = projectFile.technology === 'sls'

      if (
        (requiresGcode && payload.gcodeStorageKey === undefined) ||
        payload.volume === undefined ||
        payload.x === undefined ||
        payload.y === undefined ||
        payload.z === undefined ||
        (requiresSurfaceArea && payload.surfaceAreaMm2 === undefined)
      ) {
        return response.badRequest({ error: 'Missing slicing result fields' })
      }
      if (payload.gcodeStorageKey !== undefined) {
        projectFile.gcodeStorageKey = payload.gcodeStorageKey
      }
      projectFile.volume = payload.volume
      projectFile.x = payload.x
      projectFile.y = payload.y
      projectFile.z = payload.z
      if (payload.surfaceAreaMm2 !== undefined) {
        projectFile.surfaceAreaMm2 = payload.surfaceAreaMm2
      }
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
            infill: variant.infill ?? null, // absent for SLA variants
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

    // Terminal event on the same channel progress updates use, so the
    // frontend reacts to push instead of needing to poll once the stream
    // goes quiet.
    transmit.broadcast(`projects/${projectFile.project.uuid}/progress`, {
      fileUuid: projectFile.uuid,
      status: projectFile.status,
    })

    await autoQuoteProjectIfReady(projectFile.projectId)

    return serialize({ uuid: projectFile.uuid, status: projectFile.status })
  }
}
