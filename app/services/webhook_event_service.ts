/**
 * Idempotency guard shared by both provider webhook controllers. Stripe and
 * PayPal both retry delivery on anything but a prompt 2xx, and can
 * occasionally redeliver the same event regardless - callers check/mark
 * inside the same transaction as the state change the event triggers, so a
 * crash mid-handler is correctly retried rather than silently skipped, but a
 * fully-committed event can never be double-applied.
 */
import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import WebhookEvent from '#models/webhook_event'

export type WebhookProvider = 'stripe' | 'paypal'

export async function hasProcessed(
  provider: WebhookProvider,
  eventId: string,
  trx?: TransactionClientContract
): Promise<boolean> {
  const query = WebhookEvent.query(trx ? { client: trx } : {})
    .where('provider', provider)
    .where('eventId', eventId)
  return (await query.first()) !== null
}

export async function markProcessed(
  provider: WebhookProvider,
  eventId: string,
  eventType: string,
  trx: TransactionClientContract
): Promise<void> {
  await WebhookEvent.create(
    {
      provider,
      eventId,
      eventType,
      processedAt: DateTime.now(),
    },
    { client: trx }
  )
}
