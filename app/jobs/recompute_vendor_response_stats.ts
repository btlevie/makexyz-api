import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { recomputeAllResponseStats } from '#services/vendor_response_stats_service'

interface RecomputeVendorResponseStatsPayload {}

/**
 * Daily: recomputes every vendor's response rate and time, so unanswered
 * inquiries age into the rate (vendor_response_stats_service.ts).
 */
export default class RecomputeVendorResponseStats extends Job<RecomputeVendorResponseStatsPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const updated = await recomputeAllResponseStats()
    logger.info({ updated }, 'Recomputed vendor response stats')
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'RecomputeVendorResponseStats failed')
  }
}
