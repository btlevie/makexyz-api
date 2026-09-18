import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { escalateExpiredPreferredOrders } from '#services/order_routing_service'

interface EscalateOrderRoutingPayload {}

/**
 * Moves orders whose preferred-vendor window has closed into the open queue.
 * Runs hourly (see start/scheduler.ts) - a 24h-scale window only needs
 * checking this often, not by-the-minute, but daily would leave an order
 * stuck up to 23 hours past its window before anyone but a preferred vendor
 * could see it.
 */
export default class EscalateOrderRouting extends Job<EscalateOrderRoutingPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    const escalated = await escalateExpiredPreferredOrders()
    if (escalated > 0) {
      logger.info({ escalated }, 'Escalated orders from preferred to open routing')
    }
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'EscalateOrderRouting failed')
  }
}
