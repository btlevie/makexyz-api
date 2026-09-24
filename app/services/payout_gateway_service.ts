/**
 * Sends vendor payouts on the vendor's chosen rail - Stripe Connect transfer
 * or PayPal Payout - behind one interface, so vendor_payout_service.ts
 * doesn't care which.
 *
 * Every send carries the payout's uuid as an idempotency key (Stripe's
 * idempotency key / transfer_group, PayPal's sender_batch_id), so re-sending
 * the same payout after a crash or timeout never pays twice.
 *
 * Errors: a PayoutGatewayError is a *definite* failure, classified as
 * 'recipient' (the vendor's account is the problem - closed, restricted,
 * unregistered) or 'platform' (ours - balance, config). Anything else
 * thrown (network, timeout) is ambiguous: the money may or may not have
 * moved, so callers leave the payout 'processing' and recover it later via
 * findExisting.
 *
 * In test env this always resolves to the in-memory FakePayoutGateway.
 */
import env from '#start/env'
import { StripePayoutRail } from '#services/stripe_payout_gateway'
import { PaypalPayoutRail } from '#services/paypal_payout_gateway'

export type PayoutProvider = 'stripe' | 'paypal'
export type PayoutFailureKind = 'recipient' | 'platform'

export type SendPayoutParams = {
  provider: PayoutProvider
  /** Stripe connected account id, or PayPal payer id. */
  destination: string
  /** Decimal string, dollars. */
  amount: string
  idempotencyKey: string
  description: string
}

export type SendPayoutResult = {
  transactionId: string
  /** Stripe transfers settle synchronously; PayPal payouts finish by webhook. */
  status: 'paid' | 'processing'
}

export class PayoutGatewayError extends Error {
  constructor(
    message: string,
    public kind: PayoutFailureKind
  ) {
    super(message)
    this.name = 'PayoutGatewayError'
  }
}

/** One provider's half of the gateway - see stripe_payout_gateway.ts / paypal_payout_gateway.ts. */
export interface PayoutRail {
  send(params: SendPayoutParams): Promise<SendPayoutResult>
  /** A payout already sent under this idempotency key, or null if none is known. */
  findExisting(idempotencyKey: string): Promise<SendPayoutResult | null>
}

export interface PayoutGateway {
  send(params: SendPayoutParams): Promise<SendPayoutResult>
  findExisting(provider: PayoutProvider, idempotencyKey: string): Promise<SendPayoutResult | null>
  /** Returns an UNCLAIMED PayPal payout's funds now, rather than after PayPal's 30 days. */
  cancelUnclaimedPaypalItem(payoutItemId: string): Promise<void>
}

export class LivePayoutGateway implements PayoutGateway {
  private stripe: StripePayoutRail | null = null
  private paypal: PaypalPayoutRail | null = null

  private rail(provider: PayoutProvider): PayoutRail {
    if (provider === 'stripe') {
      this.stripe ??= new StripePayoutRail()
      return this.stripe
    }
    this.paypal ??= new PaypalPayoutRail()
    return this.paypal
  }

  send(params: SendPayoutParams): Promise<SendPayoutResult> {
    return this.rail(params.provider).send(params)
  }

  findExisting(provider: PayoutProvider, idempotencyKey: string) {
    return this.rail(provider).findExisting(idempotencyKey)
  }

  cancelUnclaimedPaypalItem(payoutItemId: string): Promise<void> {
    this.paypal ??= new PaypalPayoutRail()
    return this.paypal.cancelUnclaimedItem(payoutItemId)
  }
}

/**
 * In-memory stand-in used in test env - deterministic, no network calls.
 * Idempotent by key like the real rails: re-sending a known key returns the
 * original result without counting as a second send.
 */
export class FakePayoutGateway implements PayoutGateway {
  sends = new Map<string, SendPayoutParams & SendPayoutResult>()
  cancelledPaypalItems: string[] = []

  /** The next send fails definitively with this error, sending nothing. */
  nextError: PayoutGatewayError | null = null
  /** The next send goes through, then throws a non-gateway error - like a timeout after the money moved. */
  failNextAfterSend = false

  private nextId = 1

  /** Test-only: clears all state between tests. */
  reset(): void {
    this.sends.clear()
    this.cancelledPaypalItems = []
    this.nextError = null
    this.failNextAfterSend = false
    this.nextId = 1
  }

  get sendCount(): number {
    return this.sends.size
  }

  async send(params: SendPayoutParams): Promise<SendPayoutResult> {
    const existing = this.sends.get(params.idempotencyKey)
    if (existing) {
      return { transactionId: existing.transactionId, status: existing.status }
    }

    if (this.nextError) {
      const error = this.nextError
      this.nextError = null
      throw error
    }

    const result: SendPayoutResult =
      params.provider === 'stripe'
        ? { transactionId: `tr_fake_${this.nextId++}`, status: 'paid' }
        : { transactionId: `batch_fake_${this.nextId++}`, status: 'processing' }
    this.sends.set(params.idempotencyKey, { ...params, ...result })

    if (this.failNextAfterSend) {
      this.failNextAfterSend = false
      throw new Error('Fake network failure after send')
    }
    return result
  }

  async findExisting(
    _provider: PayoutProvider,
    idempotencyKey: string
  ): Promise<SendPayoutResult | null> {
    const existing = this.sends.get(idempotencyKey)
    return existing ? { transactionId: existing.transactionId, status: existing.status } : null
  }

  async cancelUnclaimedPaypalItem(payoutItemId: string): Promise<void> {
    this.cancelledPaypalItems.push(payoutItemId)
  }
}

export const fakePayoutGateway = new FakePayoutGateway()

export function getPayoutGateway(): PayoutGateway {
  if (env.get('NODE_ENV') === 'test') {
    return fakePayoutGateway
  }
  return new LivePayoutGateway()
}
