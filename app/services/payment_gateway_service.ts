/**
 * Payment authorization/capture, abstracted behind one interface so checkout
 * logic doesn't care whether the customer picked Stripe or PayPal.
 *
 * Authorize only ever places a hold - it must never charge the customer.
 * Capture is the only thing that actually moves money, and only ever runs
 * once a vendor accepts the order (see docs/DATABASE_FLOW.md's
 * Checkout Session -> Payment Authorization -> Order (Open) -> Vendor
 * Acceptance -> Payment Capture lifecycle).
 *
 * In test env this always resolves to the in-memory FakePaymentGateway,
 * regardless of which provider was requested, so checkout logic can be
 * exercised without live Stripe/PayPal calls. Real credentials plug in later
 * without this interface or the checkout code built against it changing.
 */
import env from '#start/env'
import { StripePaymentGateway } from '#services/stripe_payment_gateway'
import { PayPalPaymentGateway } from '#services/paypal_payment_gateway'

export type PaymentProviderName = 'stripe' | 'paypal'

export type AuthorizeParams = {
  /** Dollars, not cents - matches this codebase's decimal-string money columns. */
  amount: number
  /** Free-form identifiers attached to the provider's own record (e.g. checkoutSessionUuid). */
  metadata: Record<string, string>
  /**
   * Opaque, frontend-collected payment credential - a Stripe PaymentMethod id
   * for the Stripe gateway. Unused by PayPal, whose approval flow is a
   * redirect rather than a token handed to the backend.
   */
  providerToken?: string
}

export type AuthorizeResult = {
  transactionId: string
}

export type CaptureResult = {
  /**
   * The capture's own transaction id - not assumed to equal the authorization's
   * id. PayPal's authorize and capture calls genuinely return two different
   * ids; Stripe's PaymentIntent id stays the same, but callers must not rely
   * on that being true across providers.
   */
  transactionId: string
  providerFee: number
  netAmount: number
}

export interface PaymentGateway {
  authorize(params: AuthorizeParams): Promise<AuthorizeResult>
  capture(transactionId: string): Promise<CaptureResult>
  cancel(transactionId: string): Promise<void>
}

export class PaymentGatewayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentGatewayError'
  }
}

type FakeTransaction = {
  status: 'authorized' | 'captured' | 'cancelled'
  amount: number
}

/**
 * In-memory stand-in used in test env - deterministic, no network calls.
 * Approximates Stripe's card-processing fee (2.9% + $0.30) so tests exercise
 * realistic provider-fee/net-amount arithmetic, not just a hardcoded pass-through.
 */
export class FakePaymentGateway implements PaymentGateway {
  private transactions = new Map<string, FakeTransaction>()
  private nextId = 1

  /** Test-only: clears all state between test groups. */
  reset(): void {
    this.transactions.clear()
    this.nextId = 1
  }

  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    const transactionId = `fake_${this.nextId++}`
    this.transactions.set(transactionId, { status: 'authorized', amount: params.amount })
    return { transactionId }
  }

  async capture(transactionId: string): Promise<CaptureResult> {
    const transaction = this.transactions.get(transactionId)
    if (!transaction) {
      throw new PaymentGatewayError(`Unknown transaction ${transactionId}`)
    }
    if (transaction.status !== 'authorized') {
      throw new PaymentGatewayError(
        `Cannot capture transaction ${transactionId}: status is ${transaction.status}, not authorized`
      )
    }

    transaction.status = 'captured'
    const providerFee = Math.round((transaction.amount * 0.029 + 0.3) * 100) / 100
    const netAmount = Math.round((transaction.amount - providerFee) * 100) / 100

    return { transactionId, providerFee, netAmount }
  }

  async cancel(transactionId: string): Promise<void> {
    const transaction = this.transactions.get(transactionId)
    if (!transaction) {
      throw new PaymentGatewayError(`Unknown transaction ${transactionId}`)
    }
    if (transaction.status !== 'authorized') {
      throw new PaymentGatewayError(
        `Cannot cancel transaction ${transactionId}: status is ${transaction.status}, not authorized`
      )
    }

    transaction.status = 'cancelled'
  }
}

export const fakePaymentGateway = new FakePaymentGateway()

export function getPaymentGateway(provider: PaymentProviderName): PaymentGateway {
  if (env.get('NODE_ENV') === 'test') {
    return fakePaymentGateway
  }

  return provider === 'stripe' ? new StripePaymentGateway() : new PayPalPaymentGateway()
}
