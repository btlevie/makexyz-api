/**
 * Stripe Connect payout rail: a transfer from MakeXYZ's platform balance to
 * the vendor's connected Express account. Never exercised by tests (test env
 * always uses FakePayoutGateway, see payout_gateway_service.ts) - verify with
 * a Stripe test-mode connected account before relying on it.
 *
 * Transfers settle synchronously, so a successful create is 'paid'. The
 * platform balance must be available to cover it - the post-delivery hold
 * period is comfortably longer than Stripe's charge settlement delay.
 */
import Stripe from 'stripe'
import env from '#start/env'
import { toCents } from '#services/payout_calculation_service'
import {
  PayoutGatewayError,
  type PayoutRail,
  type SendPayoutParams,
  type SendPayoutResult,
} from '#services/payout_gateway_service'

/** Stripe error codes meaning the destination account can't receive the transfer. */
const RECIPIENT_ERROR_CODES = new Set(['account_invalid', 'transfers_not_allowed'])

export class StripePayoutRail implements PayoutRail {
  private client: Stripe

  constructor() {
    const secretKey = env.get('STRIPE_SECRET_KEY')
    if (!secretKey) {
      throw new PayoutGatewayError('STRIPE_SECRET_KEY is not configured', 'platform')
    }
    this.client = new Stripe(secretKey)
  }

  async send(params: SendPayoutParams): Promise<SendPayoutResult> {
    try {
      const transfer = await this.client.transfers.create(
        {
          amount: toCents(params.amount),
          currency: 'usd',
          destination: params.destination,
          transfer_group: params.idempotencyKey,
          description: params.description,
        },
        { idempotencyKey: params.idempotencyKey }
      )
      return { transactionId: transfer.id, status: 'paid' }
    } catch (error) {
      // Connection errors are ambiguous (the transfer may exist) - rethrown
      // as-is so the payout stays 'processing' and is recovered via
      // findExisting. Anything Stripe actually answered is definite.
      if (error instanceof Stripe.errors.StripeError && error.type !== 'StripeConnectionError') {
        const isRecipient =
          (error.code && RECIPIENT_ERROR_CODES.has(error.code)) ||
          (error.code === 'resource_missing' && error.param === 'destination')
        throw new PayoutGatewayError(
          `Stripe transfer failed: ${error.message}`,
          isRecipient ? 'recipient' : 'platform'
        )
      }
      throw error
    }
  }

  async findExisting(idempotencyKey: string): Promise<SendPayoutResult | null> {
    const transfers = await this.client.transfers.list({ transfer_group: idempotencyKey, limit: 1 })
    const transfer = transfers.data[0]
    return transfer ? { transactionId: transfer.id, status: 'paid' } : null
  }
}
