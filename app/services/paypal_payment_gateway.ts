/**
 * Real PayPal-backed PaymentGateway (Orders v2 API, direct REST calls - no
 * SDK dependency needed for this small a surface). Never exercised by tests
 * (test env always uses FakePaymentGateway, see payment_gateway_service.ts) -
 * this needs real PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET credentials, which
 * don't exist yet.
 *
 * Happy-path only: assumes the frontend has already taken the customer
 * through PayPal's approval redirect (via PayPal's JS SDK) before calling
 * authorize() - providerToken is the resulting approved order id. This does
 * not handle the customer declining/abandoning that redirect, which the
 * frontend is expected to surface before ever calling this backend.
 */
import env from '#start/env'
import {
  PaymentGatewayError,
  type AuthorizeParams,
  type AuthorizeResult,
  type CaptureResult,
  type PaymentGateway,
} from '#services/payment_gateway_service'
import { getPayPalAccessToken } from '#services/paypal_auth_service'

export class PayPalPaymentGateway implements PaymentGateway {
  private baseUrl: string

  constructor() {
    // Defaults to the sandbox host - production credentials should come with
    // an explicit PAYPAL_API_BASE_URL rather than this ever silently pointing
    // at the wrong environment.
    this.baseUrl = env.get('PAYPAL_API_BASE_URL', 'https://api-m.sandbox.paypal.com')
  }

  private async request(
    accessToken: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new PaymentGatewayError(`PayPal API request failed (${response.status}): ${errorBody}`)
    }

    if (response.status === 204) {
      return null
    }
    return response.json()
  }

  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    if (!params.providerToken) {
      throw new PaymentGatewayError(
        'PayPal authorization requires an approved order id from the frontend (providerToken)'
      )
    }

    const accessToken = await getPayPalAccessToken()
    const result = await this.request(
      accessToken,
      'POST',
      `/v2/checkout/orders/${params.providerToken}/authorize`
    )

    const authorization = result?.purchase_units?.[0]?.payments?.authorizations?.[0]
    if (!authorization || authorization.status !== 'CREATED') {
      throw new PaymentGatewayError(
        `PayPal order ${params.providerToken} did not reach an authorized state`
      )
    }

    return { transactionId: authorization.id }
  }

  async capture(transactionId: string): Promise<CaptureResult> {
    const accessToken = await getPayPalAccessToken()
    const result = await this.request(
      accessToken,
      'POST',
      `/v2/payments/authorizations/${transactionId}/capture`
    )

    const breakdown = result?.seller_receivable_breakdown
    if (!breakdown) {
      throw new PaymentGatewayError(
        `PayPal authorization ${transactionId} capture response has no fee breakdown`
      )
    }

    return {
      // PayPal's capture is a distinct object/id from the authorization it
      // came from - callers must not assume this equals transactionId.
      transactionId: result.id,
      providerFee: Number(breakdown.paypal_fee.value),
      netAmount: Number(breakdown.net_amount.value),
    }
  }

  async cancel(transactionId: string): Promise<void> {
    const accessToken = await getPayPalAccessToken()
    await this.request(accessToken, 'POST', `/v2/payments/authorizations/${transactionId}/void`)
  }
}
