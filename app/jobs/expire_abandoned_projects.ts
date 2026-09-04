import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Project from '#models/project'
import Quote from '#models/quote'
import env from '#start/env'

interface ExpireAbandonedProjectsPayload {}

/**
 * Retires instant-quote projects nobody came back to.
 *
 * A visitor who saw a price and walked away has effectively declined it - for
 * price, lead time, shipping, whatever - so the project is expired and its
 * outstanding quotes are marked rejected with reason `abandoned`. That keeps the
 * lost deal in the funnel rather than leaving it looking perpetually open.
 *
 * Nothing is deleted here; PurgeExpiredProjects reclaims storage later, after a
 * grace window in which this is still reversible.
 */
export default class ExpireAbandonedProjects extends Job<ExpireAbandonedProjectsPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    const ttlDays = env.get('ANONYMOUS_PROJECT_TTL_DAYS', 30)
    const cutoff = DateTime.now().minus({ days: ttlDays })

    const abandoned = await Project.query()
      // Manual sales projects are someone's active work; only the self-serve
      // funnel gets cleaned up automatically.
      .where('source', 'instant_quote')
      .whereIn('status', ['draft', 'quoted'])
      // Last activity, not creation - somebody who came back last week has not
      // abandoned anything.
      .where('updatedAt', '<', cutoff.toSQL()!)
      // Deliberately NOT filtered on customer_id: capturing an email attaches a
      // customer, and a lead who never returned is still abandoned.
      .whereNotExists((query) => {
        query
          .from('checkout_sessions')
          .whereRaw('checkout_sessions.project_id = projects.id')
          .whereIn('status', ['active', 'completed'])
      })

    if (abandoned.length === 0) {
      return
    }

    const expiredAt = DateTime.now()
    let rejectedQuotes = 0

    for (const project of abandoned) {
      await db.transaction(async (trx) => {
        project.useTransaction(trx)
        project.status = 'expired'
        project.expiredAt = expiredAt
        await project.save()

        // Only quotes still in play - an accepted or already-rejected quote has
        // its own outcome and must not be relabelled.
        rejectedQuotes += await Quote.query({ client: trx })
          .where('projectId', project.id)
          .whereIn('status', ['draft', 'sent'])
          .update({
            status: 'rejected',
            rejection_reason: 'abandoned',
            rejected_at: expiredAt.toSQL(),
          })
          .then((result) => Number(result) || 0)
      })
    }

    logger.info(
      { projects: abandoned.length, rejectedQuotes, ttlDays },
      'Expired abandoned instant-quote projects'
    )
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'ExpireAbandonedProjects failed')
  }
}
