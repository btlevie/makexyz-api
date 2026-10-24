import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { sweepHeldMessages } from '#services/message_analysis_service'

interface SweepHeldMessagesPayload {}

/**
 * Every 10 minutes: a message held for automated analysis longer than it
 * should take (a lost job, an attachment the scanner never answered for) gets
 * one final analysis, after which anything still undecided goes to a person.
 * Nothing stays held indefinitely.
 */
export default class SweepHeldMessages extends Job<SweepHeldMessagesPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const swept = await sweepHeldMessages()
    if (swept > 0) {
      logger.info({ swept }, 'Swept long-held messages')
    }
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'SweepHeldMessages failed')
  }
}
