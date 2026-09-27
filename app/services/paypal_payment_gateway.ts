/**
 * Real PayPal-backed PaymentGateway (Orders v2 API, direct REST calls - no
 * SDK dependency needed for this small a surface). Never exercised by
 * functional tests (test env always uses FakePaymentGateway, see
 * payment_gateway_service.ts); unit-tested with a mocked fetch.
 *
 * The backend creates the PayPal order from the quote (createOrder, via
 * POST .../quotes/:uuid/paypal-order), so the browser never sets the amount.
 * The customer approves it in PayPal's buttons, and the approved order id
 * comes back as `providerToken`. authorize() still re-reads that order and
 * refuses anything that isn't exactly this quote's total - anyone can create
 * a PayPal order with our public client id and send its id instead.
 */
import env from '#start/env'
import {
  PaymentGatewayError,
  toCents,
  type AuthorizeParams,
  type AuthorizeResult,
  type CaptureResult,
  type CreatePayPalOrderParams,
  type PaymentGateway,
} from '#services/payment_gateway_service'
import { getPayPalAccessToken } from '#services/paypal_auth_service'

type PayPalAmount = { currency_code?: string; value?: string }

/** The one USD amount matching `expectedAmount`, or a PaymentGatewayError. */
function assertAmount(amount: PayPalAmount | undefined, expectedAmount: string, what: string) {
  if (!amount || amount.currency_code !== 'USD' || amount.value === undefined) {
    throw new PaymentGatewayError(`${what} has no USD amount`)
  }
  if (toCents(amount.value) !== toCents(expectedAmount)) {
    throw new PaymentGatewayError(
      `${what} is for ${amount.value} USD, not the quote total of ${expectedAmount}`
    )
  }
}

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
        'Authorization': `Bearer ${accessToken}`,
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

  /** Creates an AUTHORIZE-intent order for exactly this quote's total; returns its id. */
  async createOrder(params: CreatePayPalOrderParams): Promise<string> {
    const accessToken = await getPayPalAccessToken()
    const order = await this.request(accessToken, 'POST', '/v2/checkout/orders', {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          custom_id: params.quoteUuid,
          amount: { currency_code: 'USD', value: params.amount },
        },
      ],
    })
    if (!order?.id) {
      throw new PaymentGatewayError('PayPal did not return an order id')
    }
    return order.id
  }

  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    if (!params.providerToken) {
      throw new PaymentGatewayError(
        'PayPal authorization requires an approved order id from the frontend (providerToken)'
      )
    }

    const accessToken = await getPayPalAccessToken()
    const orderPath = `/v2/checkout/orders/${encodeURIComponent(params.providerToken)}`

    // Verify before authorizing - never place a hold for the wrong amount.
    const order = await this.request(accessToken, 'GET', orderPath)
    const what = `PayPal order ${params.providerToken}`
    if (order?.intent !== 'AUTHORIZE' || order?.status !== 'APPROVED') {
      throw new PaymentGatewayError(
        `${what} is not an approved authorization order (intent ${order?.intent}, status ${order?.status})`
      )
    }
    const units = order.purchase_units ?? []
    if (units.length !== 1 || units[0].custom_id !== params.quoteUuid) {
      throw new PaymentGatewayError(`${what} was not created for quote ${params.quoteUuid}`)
    }
    assertAmount(units[0].amount, params.expectedAmount, what)

    const result = await this.request(accessToken, 'POST', `${orderPath}/authorize`)
    const authorization = result?.purchase_units?.[0]?.payments?.authorizations?.[0]
    if (!authorization || authorization.status !== 'CREATED') {
      throw new PaymentGatewayError(`${what} did not reach an authorized state`)
    }
    assertAmount(
      authorization.amount,
      params.expectedAmount,
      `PayPal authorization ${authorization.id}`
    )

    return { status: 'authorized', transactionId: authorization.id }
  }

  /**
   * PayPal approval happens before authorize() is ever called, so a PayPal
   * authorization never awaits customer action - this only re-confirms an
   * existing hold.
   */
  async retrieve(
    transactionId: string,
    expected: { expectedAmount: string }
  ): Promise<AuthorizeResult> {
    const accessToken = await getPayPalAccessToken()
    const authorization = await this.request(
      accessToken,
      'GET',
      `/v2/payments/authorizations/${encodeURIComponent(transactionId)}`
    )
    if (authorization?.status !== 'CREATED') {
      throw new PaymentGatewayError(
        `PayPal authorization ${transactionId} is ${authorization?.status}, not an active hold`
      )
    }
    assertAmount(
      authorization.amount,
      expected.expectedAmount,
      `PayPal authorization ${transactionId}`
    )
    return { status: 'authorized', transactionId }
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
