import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { checkVendorImage } from '#services/vendor_image_service'

interface ScanVendorImagePayload {
  imageId: number
}

/**
 * Checks one uploaded vendor image: malware verdict, re-encode, Rekognition,
 * text in the image, then publication (vendor_image_service.ts). Re-queues
 * itself while the malware scanner hasn't answered.
 */
export default class ScanVendorImage extends Job<ScanVendorImagePayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    await checkVendorImage(this.payload.imageId)
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'ScanVendorImage failed')
  }
}
