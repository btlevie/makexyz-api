/**
 * Real Stripe-backed PaymentGateway. Never exercised by functional tests
 * (test env always uses FakePaymentGateway, see payment_gateway_service.ts);
 * unit-tested with a stubbed client.
 *
 * Confirms the PaymentIntent server-side (`confirm: true`) with the
 * PaymentMethod Stripe.js created in the browser - the card number never
 * reaches this API. `capture_method: 'manual'` makes it a hold, captured
 * only when a vendor accepts the order.
 *
 * 3D Secure: when the bank requires verification the intent comes back
 * `requires_action`, and authorize() returns its client secret instead of
 * failing. The frontend completes the challenge in-page with Stripe.js
 * (`handleNextAction` - card 3DS needs no redirect, hence
 * `allow_redirects: 'never'`), then checkout calls retrieve() to pick the
 * now-authorized intent back up.
 */
import Stripe from 'stripe'
import env from '#start/env'
import {
  PaymentGatewayError,
  toCents,
  type AuthorizeParams,
  type AuthorizeResult,
  type CaptureResult,
  type PaymentGateway,
} from '#services/payment_gateway_service'

export class StripePaymentGateway implements PaymentGateway {
  private client: Stripe

  /** `client` is injectable for unit tests; production builds one from STRIPE_SECRET_KEY. */
  constructor(client?: Stripe) {
    if (client) {
      this.client = client
      return
    }
    const secretKey = env.get('STRIPE_SECRET_KEY')
    if (!secretKey) {
      throw new PaymentGatewayError('STRIPE_SECRET_KEY is not configured')
    }
    this.client = new Stripe(secretKey)
  }

  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    if (!params.providerToken) {
      throw new PaymentGatewayError(
        'Stripe authorization requires a frontend-collected payment method (providerToken)'
      )
    }

    const intent = await this.client.paymentIntents.create({
      amount: toCents(params.expectedAmount),
      currency: 'usd',
      capture_method: 'manual',
      confirm: true,
      payment_method: params.providerToken,
      metadata: { ...params.metadata, quoteUuid: params.quoteUuid },
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    })

    return this.outcomeOf(intent)
  }

  async retrieve(
    transactionId: string,
    expected: { expectedAmount: string }
  ): Promise<AuthorizeResult> {
    const intent = await this.client.paymentIntents.retrieve(transactionId)
    if (intent.amount !== toCents(expected.expectedAmount) || intent.currency !== 'usd') {
      throw new PaymentGatewayError(
        `Stripe PaymentIntent ${intent.id} is for ${intent.amount} ${intent.currency}, not the quote total`
      )
    }
    return this.outcomeOf(intent)
  }

  /**
   * requires_capture is an authorized hold; requires_action awaits the
   * customer (3D Secure). Anything else - requires_payment_method after a
   * failed challenge or decline, canceled, etc. - is a failed authorization.
   */
  private outcomeOf(intent: Stripe.PaymentIntent): AuthorizeResult {
    if (intent.status === 'requires_capture') {
      return { status: 'authorized', transactionId: intent.id }
    }
    if (intent.status === 'requires_action' && intent.client_secret) {
      return {
        status: 'requires_action',
        transactionId: intent.id,
        clientSecret: intent.client_secret,
      }
    }
    throw new PaymentGatewayError(
      `Stripe PaymentIntent ${intent.id} did not reach an authorized state (status: ${intent.status})`
    )
  }

  async capture(transactionId: string): Promise<CaptureResult> {
    const intent = await this.client.paymentIntents.capture(transactionId)

    const charge = intent.latest_charge
    const balanceTransactionId =
      typeof charge === 'string' ? undefined : (charge?.balance_transaction as string | undefined)

    if (!balanceTransactionId) {
      throw new PaymentGatewayError(
        `Stripe PaymentIntent ${transactionId} has no balance transaction to read the real fee from`
      )
    }

    const balanceTransaction = await this.client.balanceTransactions.retrieve(balanceTransactionId)

    return {
      transactionId: intent.id,
      providerFee: balanceTransaction.fee / 100,
      netAmount: balanceTransaction.net / 100,
    }
  }

  async cancel(transactionId: string): Promise<void> {
    await this.client.paymentIntents.cancel(transactionId)
  }
}
