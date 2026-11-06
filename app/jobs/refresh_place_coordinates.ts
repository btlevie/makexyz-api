import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { refreshPlaceCoordinates } from '#services/geocoding_service'

interface RefreshPlaceCoordinatesPayload {}

/**
 * Daily: keeps cached city coordinates within Google's 30-day limit -
 * re-fetches entries about to expire, deletes expired ones
 * (geocoding_service.ts#refreshPlaceCoordinates).
 */
export default class RefreshPlaceCoordinates extends Job<RefreshPlaceCoordinatesPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const result = await refreshPlaceCoordinates()
    logger.info(result, 'Refreshed place coordinates')
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'RefreshPlaceCoordinates failed')
  }
}
