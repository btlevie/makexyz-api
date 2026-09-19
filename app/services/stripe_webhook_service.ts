/**
 * Stripe webhook signature verification. Local HMAC check via the SDK's own
 * webhooks helper - no network call, unlike PayPal's (see
 * paypal_webhook_service.ts), so this is exercised for real in tests using
 * Stripe's own `generateTestHeaderString` helper rather than a Fake.
 */
import Stripe from 'stripe'
import env from '#start/env'

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
  }
}

function getClient(): Stripe {
  const secretKey = env.get('STRIPE_SECRET_KEY')
  if (!secretKey) {
    throw new WebhookVerificationError('STRIPE_SECRET_KEY is not configured')
  }
  return new Stripe(secretKey)
}

export function verifyStripeWebhook(
  rawBody: string | Buffer,
  signatureHeader: string | undefined
): Stripe.Event {
  const webhookSecret = env.get('STRIPE_WEBHOOK_SECRET')
  if (!webhookSecret) {
    throw new WebhookVerificationError('STRIPE_WEBHOOK_SECRET is not configured')
  }
  if (!signatureHeader) {
    throw new WebhookVerificationError('Missing stripe-signature header')
  }

  try {
    return getClient().webhooks.constructEvent(rawBody, signatureHeader, webhookSecret)
  } catch (error) {
    throw new WebhookVerificationError(
      `Stripe webhook signature verification failed: ${(error as Error).message}`
    )
  }
}
