import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import drive from '@adonisjs/drive/services/main'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import AuditEvent from '#models/audit_event'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import env from '#start/env'

interface PurgeExpiredProjectsPayload {}

/**
 * Reclaims storage from expired projects, once the grace window has passed.
 *
 * Deletes only the expensive and sensitive things - S3 objects and the file rows
 * describing them. The `projects` and `quotes` rows stay forever, because they
 * are the funnel record: what we quoted, for how much, and that it was never
 * bought.
 *
 * Keeping the project row also avoids a trap: every foreign key into `projects`
 * is SET NULL rather than CASCADE, so deleting one would orphan its quotes and
 * files instead of cleaning them up.
 *
 * `quote_items.project_file_id` is SET NULL too, so quote items survive with
 * their `pricing_snapshot` intact - the grams, dimensions and price breakdown
 * remain queryable long after the model itself is gone.
 */
export default class PurgeExpiredProjects extends Job<PurgeExpiredProjectsPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    const graceDays = env.get('PROJECT_PURGE_GRACE_DAYS', 7)
    const cutoff = DateTime.now().minus({ days: graceDays })

    const projects = await Project.query()
      .where('status', 'expired')
      .where('expiredAt', '<', cutoff.toSQL()!)
      // "Still has files" is the idempotency marker - once purged a project has
      // none, so it drops out and a re-run is a no-op. No purged_at column needed.
      .whereHas('projectFiles', (query) => query)

    if (projects.length === 0) {
      return
    }

    for (const project of projects) {
      await this.purge(project)
    }

    logger.info({ projects: projects.length, graceDays }, 'Purged expired project storage')
  }

  private async purge(project: Project) {
    const projectFiles = await ProjectFile.query()
      .where('projectId', project.id)
      .preload('sliceVariants')

    // Everything this project put in S3: the uploaded model, its baseline
    // output, and every slice variant's output. Deleted key by key - never
    // deleteAll(prefix), which cannot distinguish these from anything else
    // sharing the prefix.
    const storageKeys = new Set<string>()
    for (const projectFile of projectFiles) {
      for (const key of [
        projectFile.fileStorageKey,
        projectFile.gcodeStorageKey,
        ...projectFile.sliceVariants.map((variant) => variant.gcodeStorageKey),
      ]) {
        if (key) {
          storageKeys.add(key)
        }
      }
    }

    let deletedObjects = 0
    for (const key of storageKeys) {
      try {
        await drive.use('s3').delete(key)
        deletedObjects++
      } catch (error) {
        // Best effort: a stuck object must not block reclaiming the rest, and
        // the project stays selectable next run until its files are gone.
        logger.warn(
          { projectUuid: project.uuid, storageKey: key, error: String(error) },
          'Failed to delete an object while purging an expired project'
        )
      }
    }

    const quotedTotal = await Quote.query()
      .where('projectId', project.id)
      .orderBy('revision', 'desc')
      .first()

    await db.transaction(async (trx) => {
      // The scheduler offers no overlap prevention, so two runs can select the
      // same project. Lock it and re-check: whichever gets here second finds no
      // files left and skips, so the audit row is written exactly once and the
      // purge count stays truthful.
      await Project.query({ client: trx }).where('id', project.id).forUpdate().first()

      const remaining = await ProjectFile.query({ client: trx })
        .where('projectId', project.id)
        .count('* as total')
      if (Number(remaining[0].$extras.total) === 0) {
        return
      }

      for (const projectFile of projectFiles) {
        await projectFile.useTransaction(trx).related('sliceVariants').query().delete()
      }

      await ProjectFile.query({ client: trx }).where('projectId', project.id).delete()

      await AuditEvent.create(
        {
          entityType: 'project',
          entityId: project.id,
          eventType: 'deleted',
          payload: {
            reason: 'purged_expired_project_storage',
            projectUuid: project.uuid,
            source: project.source,
            fileCount: projectFiles.length,
            deletedObjects,
            quotedTotal: quotedTotal?.total ?? null,
            expiredAt: project.expiredAt?.toISO() ?? null,
          },
        },
        { client: trx }
      )
    })
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'PurgeExpiredProjects failed')
  }
}
