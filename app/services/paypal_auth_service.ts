/**
 * PayPal OAuth (client_credentials grant - app-to-app, no user involved and
 * no refresh token issued, since there's no user session to refresh).
 * Shared by paypal_payment_gateway.ts and paypal_webhook_service.ts so
 * neither re-authenticates independently.
 *
 * Caches the access token in memory for the life of this process, refetching
 * only once it's within a minute of expiry - PayPal's own client_credentials
 * tokens are typically valid for hours, so a fresh token on every API call
 * (the prior behavior here) cost an extra request/response for no reason.
 * Per-process only, not shared across workers/deploys - reacquiring a token
 * is cheap and instant, so nothing needs to persist across a restart.
 */
import { DateTime } from 'luxon'
import env from '#start/env'
import { PaymentGatewayError } from '#services/payment_gateway_service'

function requireEnv(name: 'PAYPAL_CLIENT_ID' | 'PAYPAL_CLIENT_SECRET'): string {
  const value = env.get(name)
  if (!value) {
    throw new PaymentGatewayError(`${name} is not configured`)
  }
  return value
}

function getBaseUrl(): string {
  return env.get('PAYPAL_API_BASE_URL', 'https://api-m.sandbox.paypal.com')
}

let cachedToken: { accessToken: string; expiresAt: DateTime } | null = null

export async function getPayPalAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > DateTime.now().plus({ seconds: 60 })) {
    return cachedToken.accessToken
  }

  const clientId = requireEnv('PAYPAL_CLIENT_ID')
  const clientSecret = requireEnv('PAYPAL_CLIENT_SECRET')
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(`${getBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) {
    throw new PaymentGatewayError(`PayPal OAuth token request failed: ${response.status}`)
  }

  const body = (await response.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: DateTime.now().plus({ seconds: body.expires_in }),
  }
  return cachedToken.accessToken
}

/** Test-only: clears the cached token between test groups. */
export function resetPayPalAccessTokenCache(): void {
  cachedToken = null
}

/** Test-only: forces the cache into a specific state, e.g. an already-expired token. */
export function setPayPalAccessTokenCacheForTesting(
  token: { accessToken: string; expiresAt: DateTime } | null
): void {
  cachedToken = token
}
