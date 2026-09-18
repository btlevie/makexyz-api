/**
 * Real Stripe-backed PaymentGateway. Never exercised by tests (test env
 * always uses FakePaymentGateway, see payment_gateway_service.ts) - this is
 * the implementation that needs real STRIPE_SECRET_KEY credentials to run at
 * all, which don't exist yet.
 *
 * Happy-path only, matching the rest of this plan's scope: uses PaymentIntent's
 * synchronous confirm (`confirm: true` with a frontend-collected payment
 * method) rather than a webhook-driven async flow, so authorize() resolves in
 * one request/response. This does not handle 3D Secure redirects or other
 * cases requiring further customer action after the initial request - those,
 * plus webhook-based reliability against a dropped response, are deferred
 * hardening, not this pass.
 */
import Stripe from 'stripe'
import env from '#start/env'
import {
  PaymentGatewayError,
  type AuthorizeParams,
  type AuthorizeResult,
  type CaptureResult,
  type PaymentGateway,
} from '#services/payment_gateway_service'

export class StripePaymentGateway implements PaymentGateway {
  private client: Stripe

  constructor() {
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

    const amountInCents = Math.round(params.amount * 100)
    const intent = await this.client.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      capture_method: 'manual',
      confirm: true,
      payment_method: params.providerToken,
      metadata: params.metadata,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    })

    if (intent.status !== 'requires_capture') {
      throw new PaymentGatewayError(
        `Stripe PaymentIntent ${intent.id} did not reach an authorized state (status: ${intent.status})`
      )
    }

    return { transactionId: intent.id }
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
