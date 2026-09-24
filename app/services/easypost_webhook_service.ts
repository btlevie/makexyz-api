/**
 * EasyPost webhook signature verification. Like Stripe's (see
 * stripe_webhook_service.ts) this is a local HMAC-SHA256 check against a
 * shared secret - no network call - so tests exercise it for real by signing
 * payloads with EASYPOST_WEBHOOK_SECRET rather than faking it.
 */
import EasyPostModule from '@easypost/api'
import env from '#start/env'

// See easypost_shipping_label_gateway.ts for why this cast is needed.
const EasyPost = EasyPostModule as unknown as (typeof EasyPostModule)['default']

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
  }
}

export type EasypostEvent = {
  id: string
  description: string
  result?: Record<string, any> | null
}

export function verifyEasypostWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>
): EasypostEvent {
  const webhookSecret = env.get('EASYPOST_WEBHOOK_SECRET')
  if (!webhookSecret) {
    throw new WebhookVerificationError('EASYPOST_WEBHOOK_SECRET is not configured')
  }

  // validateWebhook is a pure HMAC check that never touches the API key, but
  // it's only exposed on a client instance - the key is only needed to
  // satisfy the constructor.
  const client = new EasyPost(env.get('EASYPOST_API_KEY') ?? 'webhook-verification-only')
  try {
    return client.Utils.validateWebhook(
      Buffer.from(rawBody, 'utf8'),
      headers,
      webhookSecret
    ) as EasypostEvent
  } catch (error) {
    throw new WebhookVerificationError(
      `EasyPost webhook signature verification failed: ${(error as Error).message}`
    )
  }
}
