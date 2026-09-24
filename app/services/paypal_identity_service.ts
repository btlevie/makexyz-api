/**
 * Log in with PayPal - how a vendor connects PayPal for payouts. PayPal has
 * no API to check whether an email belongs to an active account (a payout to
 * one that doesn't sits UNCLAIMED for 30 days), so instead the vendor signs
 * in with PayPal and we keep the verified payer_id it returns. Payouts are
 * then sent to that id (recipient_type PAYPAL_ID), never to a typed email.
 *
 * Requires "Log in with PayPal" enabled on the PayPal REST app, with the
 * email and PayPal account ID attributes, and PAYPAL_OAUTH_REDIRECT_URL
 * registered as a return URL.
 *
 * In test env this always resolves to FakePaypalIdentityClient.
 */
import env from '#start/env'

export class PaypalIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaypalIdentityError'
  }
}

export type PaypalIdentity = {
  payerId: string | null
  email: string | null
  verifiedAccount: boolean
}

export interface PaypalIdentityClient {
  buildAuthorizeUrl(state: string): string
  /** Exchanges the authorization code and returns the signed-in account's identity. */
  fetchIdentity(code: string): Promise<PaypalIdentity>
}

const SCOPES = 'openid email https://uri.paypal.com/services/paypalattributes'

type RequiredEnvName =
  | 'PAYPAL_CLIENT_ID'
  | 'PAYPAL_CLIENT_SECRET'
  | 'PAYPAL_OAUTH_REDIRECT_URL'
  | 'PAYPAL_AUTHORIZE_BASE_URL'

function requireEnv(name: RequiredEnvName): string {
  const value = env.get(name)
  if (!value) {
    throw new PaypalIdentityError(`${name} is not configured`)
  }
  return value
}

/** Real PayPal-backed client (raw REST, like paypal_payment_gateway.ts). Never exercised by tests. */
export class RealPaypalIdentityClient implements PaypalIdentityClient {
  buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      flowEntry: 'static',
      client_id: requireEnv('PAYPAL_CLIENT_ID'),
      response_type: 'code',
      scope: SCOPES,
      redirect_uri: requireEnv('PAYPAL_OAUTH_REDIRECT_URL'),
      state,
    })
    return `${requireEnv('PAYPAL_AUTHORIZE_BASE_URL')}/signin/authorize?${params.toString()}`
  }

  async fetchIdentity(code: string): Promise<PaypalIdentity> {
    const baseUrl = env.get('PAYPAL_API_BASE_URL', 'https://api-m.sandbox.paypal.com')
    const credentials = Buffer.from(
      `${requireEnv('PAYPAL_CLIENT_ID')}:${requireEnv('PAYPAL_CLIENT_SECRET')}`
    ).toString('base64')

    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code }).toString(),
    })
    if (!tokenResponse.ok) {
      throw new PaypalIdentityError(
        `PayPal authorization code exchange failed: ${tokenResponse.status}`
      )
    }
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string }

    const userInfoResponse = await fetch(
      `${baseUrl}/v1/identity/oauth2/userinfo?schema=paypalv1.1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!userInfoResponse.ok) {
      throw new PaypalIdentityError(`PayPal userinfo request failed: ${userInfoResponse.status}`)
    }
    const userInfo = (await userInfoResponse.json()) as {
      payer_id?: string
      verified_account?: boolean | string
      emails?: { value: string; primary?: boolean }[]
    }

    const email =
      userInfo.emails?.find((entry) => entry.primary)?.value ?? userInfo.emails?.[0]?.value ?? null
    return {
      payerId: userInfo.payer_id ?? null,
      email,
      // Documented as a boolean, but some API versions return it as a string.
      verifiedAccount: userInfo.verified_account === true || userInfo.verified_account === 'true',
    }
  }
}

const DEFAULT_FAKE_IDENTITY: PaypalIdentity = {
  payerId: 'FAKEPAYER1',
  email: 'vendor@paypal.test',
  verifiedAccount: true,
}

/** In-memory stand-in used in test env: any code except 'invalid' maps to `nextIdentity`. */
export class FakePaypalIdentityClient implements PaypalIdentityClient {
  nextIdentity: PaypalIdentity = { ...DEFAULT_FAKE_IDENTITY }

  /** Test-only: clears all state between tests. */
  reset(): void {
    this.nextIdentity = { ...DEFAULT_FAKE_IDENTITY }
  }

  buildAuthorizeUrl(state: string): string {
    return `https://paypal.test/signin/authorize?state=${encodeURIComponent(state)}`
  }

  async fetchIdentity(code: string): Promise<PaypalIdentity> {
    if (code === 'invalid') {
      throw new PaypalIdentityError('Fake invalid authorization code')
    }
    return { ...this.nextIdentity }
  }
}

export const fakePaypalIdentityClient = new FakePaypalIdentityClient()

export function getPaypalIdentityClient(): PaypalIdentityClient {
  if (env.get('NODE_ENV') === 'test') {
    return fakePaypalIdentityClient
  }
  return new RealPaypalIdentityClient()
}
