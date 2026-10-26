import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { discoverAbusePatterns } from '#services/abuse_pattern_service'

interface DiscoverAbusePatternsPayload {}

/**
 * Weekly: groups the past week's confirmed violations - especially the ones
 * automation missed - into clusters for an engineer to turn into rules
 * (abuse_pattern_service.ts). Read-only output; it never changes a rule.
 */
export default class DiscoverAbusePatterns extends Job<DiscoverAbusePatternsPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const report = await discoverAbusePatterns()
    logger.info(
      {
        report: report.uuid,
        violations: report.violations,
        clusters: report.clusters?.length ?? 0,
      },
      'Abuse pattern report written'
    )
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'DiscoverAbusePatterns failed')
  }
}
