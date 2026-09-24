/**
 * Records refunds and disputes discovered via a payment-provider webhook -
 * events that can only ever originate outside this app (a refund issued
 * from the Stripe/PayPal dashboard, a dispute/chargeback filed by the
 * customer's bank). Both functions take an already-open transaction so the
 * calling webhook controller can wrap signature verification, idempotency
 * marking, and this state change in one atomic unit.
 */
import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import AuditEvent from '#models/audit_event'
import CheckoutSession from '#models/checkout_session'
import Order from '#models/order'
import Payment from '#models/payment'
import Refund from '#models/refund'
import type { WebhookProvider } from '#services/webhook_event_service'

/** Refunds and disputes only ever come from a payment provider, not EasyPost. */
type PaymentWebhookProvider = Exclude<WebhookProvider, 'easypost'>

export type RecordRefundInput = {
  payment: Payment
  /** Dollars, not cents - matches this codebase's decimal-string money columns. */
  amount: number
  reason: string | null
  provider: PaymentWebhookProvider
  providerRefundId: string
}

/**
 * Creates the Refund row and marks the Payment refunded. If the refunded
 * amount covers the full captured amount, also marks the Order refunded -
 * left alone for a partial refund, since there's no 'partially_refunded'
 * status to set (the Refund row still records the history either way).
 */
export async function recordRefund(
  input: RecordRefundInput,
  trx: TransactionClientContract
): Promise<Refund> {
  const refund = await Refund.create(
    {
      paymentId: input.payment.id,
      amount: input.amount.toFixed(2),
      reason: input.reason,
      provider: input.provider,
      providerRefundId: input.providerRefundId,
      status: 'succeeded',
    },
    { client: trx }
  )

  input.payment.useTransaction(trx)
  input.payment.status = 'refunded'
  input.payment.refundedAt = DateTime.now()
  await input.payment.save()

  const isFullRefund = input.amount >= Number(input.payment.amount)
  if (isFullRefund && input.payment.checkoutSessionId) {
    const checkoutSession = await CheckoutSession.query({ client: trx })
      .where('id', input.payment.checkoutSessionId)
      .first()
    if (checkoutSession?.quoteId) {
      await Order.query({ client: trx })
        .where('quoteId', checkoutSession.quoteId)
        .update({ status: 'refunded' })
    }
  }

  return refund
}

export type RecordDisputeInput = {
  payment: Payment
  provider: PaymentWebhookProvider
  providerDisputeId: string
  amount: number
  reason: string | null
  status: string
  /** 'dispute_created' or 'dispute_closed' - the actual sub-type, since
   * audit_events.event_type is a fixed created|updated|deleted CHECK
   * constraint, not free-form (see payload.reason below). */
  disputeEvent: 'dispute_created' | 'dispute_closed'
}

/**
 * No 'disputed' status exists on Payment/Order, and adding one is a bigger
 * state-machine decision than a webhook handler should make unilaterally -
 * recorded as an AuditEvent instead, giving staff visibility without
 * inventing new business rules about what a dispute should *do* to an
 * order. Matches the audit-event pattern already used for project-file
 * events in project_files_controller.ts, where the specific reason lives in
 * `payload.reason`, not `event_type` (that column only allows
 * 'created'|'updated'|'deleted').
 */
export async function recordDispute(
  input: RecordDisputeInput,
  trx: TransactionClientContract
): Promise<void> {
  await AuditEvent.create(
    {
      entityType: 'payment',
      entityId: input.payment.id,
      eventType: 'updated',
      userId: null,
      payload: {
        reason: input.disputeEvent,
        provider: input.provider,
        providerDisputeId: input.providerDisputeId,
        amount: input.amount,
        disputeReason: input.reason,
        status: input.status,
      },
    },
    { client: trx }
  )
}

/**
 * Whether a payment has a dispute that hasn't closed yet. Disputes exist only
 * as audit events (see recordDispute above), so this replays them: a dispute
 * is open when its latest event is 'dispute_created'. Used to hold vendor
 * payouts (see vendor_payout_service.ts) - `openedAfter` skips disputes an
 * admin already reviewed when releasing an earlier hold.
 */
export async function hasOpenDispute(
  paymentId: number,
  trx?: TransactionClientContract,
  openedAfter?: DateTime | null
): Promise<boolean> {
  const events = await AuditEvent.query(trx ? { client: trx } : {})
    .where('entityType', 'payment')
    .where('entityId', paymentId)
    .orderBy('id', 'asc')

  const latestByDispute = new Map<string, string>()
  const openedAtByDispute = new Map<string, DateTime | null>()
  for (const event of events) {
    const reason = event.payload?.reason
    if (reason === 'dispute_created' || reason === 'dispute_closed') {
      const disputeKey = String(event.payload.providerDisputeId ?? event.id)
      latestByDispute.set(disputeKey, reason)
      if (reason === 'dispute_created' && !openedAtByDispute.has(disputeKey)) {
        openedAtByDispute.set(disputeKey, event.createdAt)
      }
    }
  }
  return [...latestByDispute.entries()].some(([disputeKey, reason]) => {
    if (reason !== 'dispute_created') return false
    const openedAt = openedAtByDispute.get(disputeKey)
    return !openedAfter || !openedAt || openedAt > openedAfter
  })
}
