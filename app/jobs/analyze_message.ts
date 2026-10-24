import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { analyzeHeldMessage, releaseHeldMessage } from '#services/message_analysis_service'

interface AnalyzeMessagePayload {
  messageId: number
  /** Last attempt: anything still undecided goes to a person instead of waiting. */
  final?: boolean
}

/**
 * The async moderation pass for a held message: analyses its links (Web
 * Risk, redirects, domain age) and judges it again with the results. See
 * message_analysis_service.ts. Idempotent - it no-ops once the message has
 * left 'held'.
 */
export default class AnalyzeMessage extends Job<AnalyzeMessagePayload> {
  // 'default', like every other job (`node ace queue:work` only runs
  // 'default' without -q - see SendMessageNotifications).
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    await analyzeHeldMessage(this.payload.messageId, { final: this.payload.final ?? false })
  }

  /** Never leave a message held because analysis kept failing - a person decides. */
  async failed(error: Error) {
    logger.error(
      { messageId: this.payload.messageId, error: error.message },
      'AnalyzeMessage failed; sending the message to review'
    )
    await releaseHeldMessage(this.payload.messageId, 'analysis_failed')
  }
}
