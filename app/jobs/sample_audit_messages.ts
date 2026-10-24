import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { sampleAuditMessages } from '#services/behavior_pattern_service'

interface SampleAuditMessagesPayload {}

/**
 * Daily: queues a small random sample of yesterday's delivered, unflagged
 * messages for review at low priority - how moderators find what the rules
 * let through (behavior_pattern_service.ts#sampleAuditMessages).
 */
export default class SampleAuditMessages extends Job<SampleAuditMessagesPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 1,
  }

  async execute() {
    const sampled = await sampleAuditMessages()
    logger.info({ sampled }, 'Sampled messages for audit')
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'SampleAuditMessages failed')
  }
}
