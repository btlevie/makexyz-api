import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { refreshPlaceIds } from '#services/geocoding_service'

interface RefreshPlaceIdsPayload {}

/**
 * Monthly: refreshes stored Google place IDs older than 12 months, as Google
 * recommends (geocoding_service.ts#refreshPlaceIds). The ID-only lookup is
 * free.
 */
export default class RefreshPlaceIds extends Job<RefreshPlaceIdsPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const result = await refreshPlaceIds()
    logger.info(result, 'Refreshed place IDs')
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'RefreshPlaceIds failed')
  }
}
