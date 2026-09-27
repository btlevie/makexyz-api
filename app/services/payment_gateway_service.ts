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
  /**
   * The quote total being authorized, as a decimal string (matches this
   * codebase's decimal-string money columns). Gateways compare amounts in
   * integer cents via toCents(), never as floats.
   */
  expectedAmount: string
  /** The quote being paid - PayPal checks its order was created for exactly this quote. */
  quoteUuid: string
  /** Free-form identifiers attached to the provider's own record (e.g. checkoutSessionUuid). */
  metadata: Record<string, string>
  /**
   * Opaque, frontend-collected payment credential - a Stripe PaymentMethod id
   * (card details go straight from Stripe.js to Stripe, never through this
   * API), or the id of a PayPal order the customer approved (created by
   * createPayPalOrder, so the backend sets its amount).
   */
  providerToken?: string
}

/**
 * Where an authorization stands. `requires_action` means the customer must
 * complete a step in the browser first (Stripe 3D Secure): the frontend
 * passes `clientSecret` to Stripe.js, then asks again via retrieve().
 */
export type AuthorizeResult =
  | { status: 'authorized'; transactionId: string }
  | { status: 'requires_action'; transactionId: string; clientSecret: string }

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
  /** Throws PaymentGatewayError when the payment is declined or doesn't match the quote. */
  authorize(params: AuthorizeParams): Promise<AuthorizeResult>
  /**
   * Re-reads an authorization that returned `requires_action`, once the
   * customer has completed it. Throws PaymentGatewayError if it failed, was
   * cancelled, or no longer matches `expectedAmount`.
   */
  retrieve(transactionId: string, expected: { expectedAmount: string }): Promise<AuthorizeResult>
  capture(transactionId: string): Promise<CaptureResult>
  /** Releases a hold, or abandons an authorization still awaiting customer action. */
  cancel(transactionId: string): Promise<void>
}

export class PaymentGatewayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentGatewayError'
  }
}

/**
 * A decimal money amount ('139.32', or a plain number from SQLite) as integer
 * cents - the only form amounts are compared in, so float rounding can never
 * let a mismatched amount through. Rejects anything finer than a cent.
 */
export function toCents(amount: string | number): number {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(amount).trim())
  if (!match) {
    throw new PaymentGatewayError(`Invalid money amount: ${amount}`)
  }
  const fraction = match[2] ?? ''
  if (/[^0]/.test(fraction.slice(2))) {
    throw new PaymentGatewayError(`Money amount has fractional cents: ${amount}`)
  }
  return Number(match[1]) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'))
}

type FakeTransaction = {
  status: 'requires_action' | 'authorized' | 'captured' | 'cancelled' | 'failed'
  amountCents: number
}

/**
 * In-memory stand-in used in test env - deterministic, no network calls.
 * Approximates Stripe's card-processing fee (2.9% + $0.30) so tests exercise
 * realistic provider-fee/net-amount arithmetic, not just a hardcoded pass-through.
 */
export class FakePaymentGateway implements PaymentGateway {
  private transactions = new Map<string, FakeTransaction>()
  private nextId = 1
  private nextAuthorize: 'authorized' | 'requires_action' | 'declined' = 'authorized'

  /** Test-only: clears all state between test groups. */
  reset(): void {
    this.transactions.clear()
    this.nextId = 1
    this.nextAuthorize = 'authorized'
  }

  /** Test-only: the next authorize() needs customer action (like a 3D Secure card). */
  requireActionOnNextAuthorize(): void {
    this.nextAuthorize = 'requires_action'
  }

  /** Test-only: the next authorize() is declined. */
  declineNextAuthorize(): void {
    this.nextAuthorize = 'declined'
  }

  /** Test-only: how the customer's action on a `requires_action` transaction ended. */
  completeAction(transactionId: string, outcome: 'authorized' | 'failed'): void {
    const transaction = this.transactions.get(transactionId)
    if (!transaction || transaction.status !== 'requires_action') {
      throw new PaymentGatewayError(`Transaction ${transactionId} is not awaiting action`)
    }
    transaction.status = outcome
  }

  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    const outcome = this.nextAuthorize
    this.nextAuthorize = 'authorized'
    if (outcome === 'declined') {
      throw new PaymentGatewayError('Your card was declined')
    }

    const transactionId = `fake_${this.nextId++}`
    this.transactions.set(transactionId, {
      status: outcome,
      amountCents: toCents(params.expectedAmount),
    })
    return outcome === 'requires_action'
      ? { status: 'requires_action', transactionId, clientSecret: `${transactionId}_secret` }
      : { status: 'authorized', transactionId }
  }

  async retrieve(
    transactionId: string,
    expected: { expectedAmount: string }
  ): Promise<AuthorizeResult> {
    const transaction = this.transactions.get(transactionId)
    if (!transaction) {
      throw new PaymentGatewayError(`Unknown transaction ${transactionId}`)
    }
    if (transaction.amountCents !== toCents(expected.expectedAmount)) {
      throw new PaymentGatewayError(`Transaction ${transactionId} amount does not match`)
    }
    if (transaction.status === 'requires_action') {
      return {
        status: 'requires_action',
        transactionId,
        clientSecret: `${transactionId}_secret`,
      }
    }
    if (transaction.status !== 'authorized') {
      throw new PaymentGatewayError(`Transaction ${transactionId} is ${transaction.status}`)
    }
    return { status: 'authorized', transactionId }
  }

  /** Test-only stand-in for PayPalPaymentGateway#createOrder. */
  async createPayPalOrder(_params: CreatePayPalOrderParams): Promise<string> {
    return `fake_paypal_order_${this.nextId++}`
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
    const amount = transaction.amountCents / 100
    const providerFee = Math.round((amount * 0.029 + 0.3) * 100) / 100
    const netAmount = Math.round((amount - providerFee) * 100) / 100

    return { transactionId, providerFee, netAmount }
  }

  async cancel(transactionId: string): Promise<void> {
    const transaction = this.transactions.get(transactionId)
    if (!transaction) {
      throw new PaymentGatewayError(`Unknown transaction ${transactionId}`)
    }
    if (transaction.status !== 'authorized' && transaction.status !== 'requires_action') {
      throw new PaymentGatewayError(
        `Cannot cancel transaction ${transactionId}: status is ${transaction.status}`
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

export type CreatePayPalOrderParams = {
  /** The quote total, as a decimal string. */
  amount: string
  quoteUuid: string
}

/**
 * Creates the PayPal order the customer then approves in PayPal's buttons -
 * on the backend, from the quote, so the browser never sets the amount.
 * Returns the PayPal order id (the later `providerToken`).
 */
export function createPayPalOrder(params: CreatePayPalOrderParams): Promise<string> {
  if (env.get('NODE_ENV') === 'test') {
    return fakePaymentGateway.createPayPalOrder(params)
  }
  return new PayPalPaymentGateway().createOrder(params)
}
