import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { shadowClassify } from '#services/llm_moderation_service'

interface LlmShadowReviewPayload {
  messageId: number
}

/**
 * Shadow mode (LLM_MODERATION_MODE=shadow): an escalated message already
 * went to a person; this records what the LLM would have decided, so its
 * verdicts can be compared with moderators' before it's allowed to decide.
 */
export default class LlmShadowReview extends Job<LlmShadowReviewPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    await shadowClassify(this.payload.messageId)
  }

  async failed(error: Error) {
    logger.error(
      { messageId: this.payload.messageId, error: error.message },
      'LlmShadowReview failed'
    )
  }
}
