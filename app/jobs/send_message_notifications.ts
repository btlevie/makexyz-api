import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { sendPendingNotification } from '#services/message_notification_service'

interface SendMessageNotificationsPayload {
  participantId: number
}

/**
 * Emails one conversation participant a digest of messages they haven't read
 * or been emailed about yet. Dispatched with a delay and a per-participant
 * dedup key by message_notification_service.ts, so a burst of messages
 * becomes one email.
 */
export default class SendMessageNotifications extends Job<SendMessageNotificationsPayload> {
  // 'default', like every other job: `node ace queue:work` only processes
  // 'default' unless started with -q, so a dedicated queue would silently
  // never run until the worker's deployment command changes too.
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    await sendPendingNotification(this.payload.participantId)
  }

  async failed(error: Error) {
    logger.error(
      { participantId: this.payload.participantId, error: error.message },
      'SendMessageNotifications failed'
    )
  }
}
