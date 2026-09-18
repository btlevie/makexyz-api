import { Job } from '@adonisjs/queue'
import type { JobOptions } from '@adonisjs/queue/types'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import CheckoutSession from '#models/checkout_session'
import { expireCheckoutSession } from '#services/checkout_service'

interface ExpireCheckoutSessionsPayload {}

/**
 * Releases held-but-never-accepted payment authorizations. Runs hourly (see
 * start/scheduler.ts) - the checkout-session expiry window is measured in
 * days, but held funds are the kind of thing worth releasing promptly once
 * they're actually past due, not once a day.
 */
export default class ExpireCheckoutSessions extends Job<ExpireCheckoutSessionsPayload> {
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    const expired = await CheckoutSession.query()
      .where('status', 'active')
      .where('expiresAt', '<=', DateTime.now().toSQL())

    for (const session of expired) {
      try {
        await expireCheckoutSession(session)
      } catch (error) {
        logger.error(
          { checkoutSessionUuid: session.uuid, error: String(error) },
          'Failed to expire a checkout session'
        )
      }
    }

    if (expired.length > 0) {
      logger.info({ expired: expired.length }, 'Expired checkout sessions')
    }
  }

  async failed(error: Error) {
    logger.error({ error: error.message }, 'ExpireCheckoutSessions failed')
  }
}
