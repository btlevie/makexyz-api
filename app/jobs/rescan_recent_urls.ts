import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { rescanRecentUrls } from '#services/message_analysis_service'

interface RescanRecentUrlsPayload {}

/**
 * Every 6 hours: re-checks links sent in the last 30 days whose cached
 * verdict has expired. Phishing pages are often set up on a clean domain and
 * weaponized later - a link that turns malicious is removed from every
 * message containing it (message_analysis_service.ts#rescanRecentUrls).
 */
export default class RescanRecentUrls extends Job<RescanRecentUrlsPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const result = await rescanRecentUrls()
    if (result.rescanned > 0) {
      logger.info(result, 'Rescanned recent message links')
    }
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'RescanRecentUrls failed')
  }
}
