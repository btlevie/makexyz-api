import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { scanAttachment } from '#services/attachment_service'

interface ScanAttachmentPayload {
  attachmentId: number
}

/**
 * Checks one uploaded attachment: malware verdict, content inspection,
 * promotion to its served location (attachment_service.ts#scanAttachment).
 * Re-queues itself while the malware scanner hasn't answered yet.
 */
export default class ScanAttachment extends Job<ScanAttachmentPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    await scanAttachment(this.payload.attachmentId)
  }

  async failed(error: Error) {
    logger.error(
      { attachmentId: this.payload.attachmentId, error: error.message },
      'ScanAttachment failed'
    )
  }
}
