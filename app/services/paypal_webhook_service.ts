/**
 * PayPal webhook signature verification. Unlike Stripe's (see
 * stripe_webhook_service.ts), this is a *remote* call to PayPal's own
 * verify-webhook-signature API - there's no local equivalent to Stripe's
 * HMAC check. Since nothing in this test suite ever hits the network, test
 * env always uses FakePaypalWebhookVerifier instead, same pattern as
 * getPaymentGateway/getTaxCalculator.
 */
import env from '#start/env'
import { getPayPalAccessToken } from '#services/paypal_auth_service'

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
  }
}

export type PaypalWebhookHeaders = {
  transmissionId: string
  transmissionTime: string
  transmissionSig: string
  certUrl: string
  authAlgo: string
}

export interface PaypalWebhookVerifier {
  /** Returns the parsed event body on success, throws WebhookVerificationError otherwise. */
  verify(rawBody: string, headers: PaypalWebhookHeaders): Promise<Record<string, any>>
}

export class RealPaypalWebhookVerifier implements PaypalWebhookVerifier {
  async verify(rawBody: string, headers: PaypalWebhookHeaders): Promise<Record<string, any>> {
    const webhookId = env.get('PAYPAL_WEBHOOK_ID')
    if (!webhookId) {
      throw new WebhookVerificationError('PAYPAL_WEBHOOK_ID is not configured')
    }

    const event = JSON.parse(rawBody)
    const accessToken = await getPayPalAccessToken()
    const baseUrl = env.get('PAYPAL_API_BASE_URL', 'https://api-m.sandbox.paypal.com')

    const response = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      }),
    })

    if (!response.ok) {
      throw new WebhookVerificationError(
        `PayPal webhook verification request failed: ${response.status}`
      )
    }

    const result = (await response.json()) as { verification_status: string }
    if (result.verification_status !== 'SUCCESS') {
      throw new WebhookVerificationError('PayPal webhook signature verification failed')
    }

    return event
  }
}

/**
 * Test-only: no network call. Deterministically accepts a fixed test
 * signature and rejects everything else, so tests can exercise both the
 * valid and invalid paths without hitting PayPal.
 */
export const FAKE_VALID_TRANSMISSION_SIG = 'fake-valid-signature'

export class FakePaypalWebhookVerifier implements PaypalWebhookVerifier {
  async verify(rawBody: string, headers: PaypalWebhookHeaders): Promise<Record<string, any>> {
    if (headers.transmissionSig !== FAKE_VALID_TRANSMISSION_SIG) {
      throw new WebhookVerificationError('PayPal webhook signature verification failed')
    }
    return JSON.parse(rawBody)
  }
}

export const fakePaypalWebhookVerifier = new FakePaypalWebhookVerifier()

export function getPaypalWebhookVerifier(): PaypalWebhookVerifier {
  if (env.get('NODE_ENV') === 'test') {
    return fakePaypalWebhookVerifier
  }
  return new RealPaypalWebhookVerifier()
}
