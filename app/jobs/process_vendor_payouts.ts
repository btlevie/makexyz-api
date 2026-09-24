import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { processDuePayouts } from '#services/vendor_payout_service'

interface ProcessVendorPayoutsPayload {}

/**
 * Sends vendor payouts whose post-delivery hold has passed, cancels payouts
 * for refunded/cancelled orders, and recovers sends that were interrupted.
 * Hourly (see start/scheduler.ts) - hold periods are measured in days.
 */
export default class ProcessVendorPayouts extends Job<ProcessVendorPayoutsPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    const summary = await processDuePayouts()
    if (summary.claimed + summary.cancelled + summary.recovered > 0) {
      logger.info(summary, 'Processed vendor payouts')
    }
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'ProcessVendorPayouts failed')
  }
}
