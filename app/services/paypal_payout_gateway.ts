/**
 * PayPal Payouts rail: a one-item payout batch to the vendor's verified
 * PayPal account (recipient_type PAYPAL_ID - see paypal_identity_service.ts).
 * Never exercised by tests (test env always uses FakePayoutGateway) - verify
 * against a PayPal sandbox before relying on it.
 *
 * Payouts are asynchronous: a created batch is 'processing', and the final
 * per-item result arrives as a PAYMENT.PAYOUTS-ITEM.* webhook (see
 * paypal_webhooks_controller.ts). Recipient problems (unregistered, locked
 * account, unclaimed) surface there, not here.
 *
 * sender_batch_id is the payout uuid, and PayPal refuses a reused one - so a
 * re-send after an ambiguous failure is always safe, and a "duplicate" answer
 * just means the first attempt went through.
 */
import env from '#start/env'
import { getPayPalAccessToken } from '#services/paypal_auth_service'
import { PaymentGatewayError } from '#services/payment_gateway_service'
import {
  PayoutGatewayError,
  type PayoutRail,
  type SendPayoutParams,
  type SendPayoutResult,
} from '#services/payout_gateway_service'

/** PayPal's names for a reused sender_batch_id. Verify against the sandbox. */
const DUPLICATE_BATCH_ERRORS = new Set(['DUPLICATE_REQUEST_ID', 'SENDER_BATCH_ID_ALREADY_USED'])

export class PaypalPayoutRail implements PayoutRail {
  private baseUrl = env.get('PAYPAL_API_BASE_URL', 'https://api-m.sandbox.paypal.com')

  private async accessToken(): Promise<string> {
    try {
      return await getPayPalAccessToken()
    } catch (error) {
      // Missing credentials or a refused token request - nothing was sent.
      if (error instanceof PaymentGatewayError) {
        throw new PayoutGatewayError(error.message, 'platform')
      }
      throw error
    }
  }

  async send(params: SendPayoutParams): Promise<SendPayoutResult> {
    const accessToken = await this.accessToken()
    const response = await fetch(`${this.baseUrl}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: params.idempotencyKey,
          email_subject: 'You have a payout from MakeXYZ',
        },
        items: [
          {
            recipient_type: 'PAYPAL_ID',
            receiver: params.destination,
            amount: { value: params.amount, currency: 'USD' },
            sender_item_id: params.idempotencyKey,
            note: params.description,
          },
        ],
      }),
    })

    if (response.ok) {
      const body = (await response.json()) as { batch_header: { payout_batch_id: string } }
      return { transactionId: body.batch_header.payout_batch_id, status: 'processing' }
    }

    // 5xx is ambiguous - rethrown as a plain error so the payout stays
    // 'processing' and is re-sent (safely, same sender_batch_id) later.
    if (response.status >= 500) {
      throw new Error(`PayPal payouts request failed (${response.status})`)
    }

    const errorBody = (await response.json().catch(() => ({}))) as {
      name?: string
      message?: string
    }
    if (errorBody.name && DUPLICATE_BATCH_ERRORS.has(errorBody.name)) {
      return { transactionId: params.idempotencyKey, status: 'processing' }
    }
    throw new PayoutGatewayError(
      `PayPal payout failed (${response.status}): ${errorBody.name ?? ''} ${errorBody.message ?? ''}`.trim(),
      'platform'
    )
  }

  /**
   * PayPal can't look a batch up by sender_batch_id, so there's nothing to
   * find - the caller re-sends instead, which the duplicate-batch handling
   * above makes safe.
   */
  async findExisting(_idempotencyKey: string): Promise<SendPayoutResult | null> {
    return null
  }

  async cancelUnclaimedItem(payoutItemId: string): Promise<void> {
    const accessToken = await this.accessToken()
    const response = await fetch(
      `${this.baseUrl}/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}/cancel`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )
    if (!response.ok) {
      throw new PayoutGatewayError(
        `PayPal unclaimed payout cancel failed (${response.status})`,
        'platform'
      )
    }
  }
}
