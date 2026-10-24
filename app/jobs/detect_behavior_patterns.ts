import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import {
  detectReportRateOutliers,
  detectSharedDomainClusters,
} from '#services/behavior_pattern_service'

interface DetectBehaviorPatternsPayload {}

/**
 * Daily: the cross-account detectors - new accounts converging on the same
 * unlisted domain, and vendors reported far more than their peers. Each
 * opens a behavioral case for a person (behavior_pattern_service.ts).
 */
export default class DetectBehaviorPatterns extends Job<DetectBehaviorPatternsPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const clusters = await detectSharedDomainClusters()
    const outliers = await detectReportRateOutliers()
    if (clusters + outliers > 0) {
      logger.info({ clusters, outliers }, 'Opened behavioral cases')
    }
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'DetectBehaviorPatterns failed')
  }
}
