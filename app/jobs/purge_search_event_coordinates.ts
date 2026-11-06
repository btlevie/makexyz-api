import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { purgeSearchEventCoordinates } from '#services/search_analytics_service'

interface PurgeSearchEventCoordinatesPayload {}

/**
 * Daily: nulls search events' coordinates after 30 days
 * (search_analytics_service.ts). Nothing downstream needs them by then - the
 * matched and canonical city pages were recorded at search time.
 */
export default class PurgeSearchEventCoordinates extends Job<PurgeSearchEventCoordinatesPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const purged = await purgeSearchEventCoordinates()
    if (purged > 0) logger.info({ purged }, 'Purged search event coordinates')
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'PurgeSearchEventCoordinates failed')
  }
}
