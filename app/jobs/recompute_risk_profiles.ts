import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { recomputeRiskProfiles } from '#services/messaging_risk_service'

interface RecomputeRiskProfilesPayload {}

/**
 * Hourly: refreshes every recently active sender's risk profile - counters,
 * automatic trust tier (promotion, auto-restriction, expiry), and the
 * volume baseline, opening a behavioral case on a volume spike (see
 * messaging_risk_service.ts#refreshRiskProfile).
 */
export default class RecomputeRiskProfiles extends Job<RecomputeRiskProfilesPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const refreshed = await recomputeRiskProfiles()
    logger.info({ refreshed }, 'Recomputed messaging risk profiles')
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'RecomputeRiskProfiles failed')
  }
}
