import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { sendModerationDigest } from '#services/moderation_digest_service'

interface SendModerationDigestPayload {}

/**
 * Daily: emails admins when senders are waiting on held messages
 * (moderation_digest_service.ts). Nothing is sent when nobody is waiting.
 */
export default class SendModerationDigest extends Job<SendModerationDigestPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const sent = await sendModerationDigest()
    if (sent > 0) logger.info({ sent }, 'Sent the moderation digest')
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'SendModerationDigest failed')
  }
}
