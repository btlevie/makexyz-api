import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { closeExpiredConversations } from '#services/conversation_service'

interface CloseExpiredConversationsPayload {}

/**
 * Makes idle inquiries and finished order threads read-only (see
 * conversation_service.ts#closeExpiredConversations). Hourly - posting to a
 * finished order is already refused at the moment it finishes, so this is
 * bookkeeping and doesn't need to be more frequent.
 */
export default class CloseExpiredConversations extends Job<CloseExpiredConversationsPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    const closed = await closeExpiredConversations()
    if (closed > 0) {
      logger.info({ closed }, 'Closed expired conversations')
    }
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'CloseExpiredConversations failed')
  }
}
