import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import Vendor from '#models/vendor'
import { geocodeVendor } from '#services/geocoding_service'

interface GeocodeVendorPayload {
  vendorId: number
}

/**
 * Locates a vendor at city precision from its default business address
 * (geocoding_service.ts#geocodeVendor). Queued whenever a vendor address
 * changes; retried when Google can't be reached.
 */
export default class GeocodeVendor extends Job<GeocodeVendorPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    const vendor = await Vendor.find(this.payload.vendorId)
    if (vendor) await geocodeVendor(vendor)
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'GeocodeVendor failed')
  }
}
