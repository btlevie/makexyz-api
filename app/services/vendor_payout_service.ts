/**
 * The vendor payout lifecycle, after acceptance created the payout (see
 * order_acceptance_service.ts / payout_calculation_service.ts):
 *
 *   pending   - waiting for delivery + the vendor's hold period (eligible_at)
 *   held      - needs admin review (partial refund, open dispute) or a fixed
 *               payout account; never sent automatically
 *   processing- claimed and sent (or being sent); PayPal stays here until its
 *               webhook reports the result
 *   paid / failed / cancelled
 *
 * Sending follows the same shape as buying a shipping label: claim the row
 * ('processing') in a transaction, call the provider outside it, then record
 * the result. The payout uuid is the provider idempotency key, so a crash or
 * timeout between those steps is recovered by re-sending (or looking the
 * transfer up) - never by paying twice. A 'processing' payout that stays
 * that way is picked up again by processDuePayouts.
 *
 * Every state change writes an AuditEvent (entity 'vendor_payout').
 */
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import string from '@adonisjs/core/helpers/string'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import AuditEvent from '#models/audit_event'
import CheckoutSession from '#models/checkout_session'
import Order from '#models/order'
import Payment from '#models/payment'
import Refund from '#models/refund'
import Vendor from '#models/vendor'
import VendorPayout, { type PayoutBreakdown } from '#models/vendor_payout'
import { fromCents, payoutHoldDays, toCents } from '#services/payout_calculation_service'
import {
  getPayoutGateway,
  PayoutGatewayError,
  type PayoutFailureKind,
  type SendPayoutResult,
} from '#services/payout_gateway_service'
import {
  flagPayoutMethodError,
  isPayoutMethodReady,
  payoutDestination,
  refreshStripeStatus,
} from '#services/vendor_payout_method_service'
import { hasOpenDispute } from '#services/refund_service'

/** A 'processing' payout untouched this long is assumed to have been interrupted. */
const STUCK_PROCESSING_MINUTES = 15

/** The action doesn't apply to a payout in its current status. */
export class PayoutNotActionableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayoutNotActionableError'
  }
}

export class InvalidPayoutAdjustmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPayoutAdjustmentError'
  }
}

async function audit(
  payout: VendorPayout,
  reason: string,
  userId: number | null,
  details: Record<string, unknown>,
  trx?: TransactionClientContract
): Promise<void> {
  await AuditEvent.create(
    {
      entityType: 'vendor_payout',
      entityId: payout.id,
      eventType: 'updated',
      userId,
      payload: { reason, payoutUuid: payout.uuid, status: payout.status, ...details },
    },
    trx ? { client: trx } : {}
  )
}

/** Inside acceptOrder's transaction - the snapshot of what the vendor accepted. */
export async function createPayoutForAcceptedOrder(
  order: Order,
  vendor: Vendor,
  breakdown: PayoutBreakdown,
  trx: TransactionClientContract
): Promise<VendorPayout> {
  const payout = await VendorPayout.create(
    {
      uuid: string.uuid(),
      vendorId: vendor.id,
      orderId: order.id,
      provider: vendor.payoutProvider!,
      amount: breakdown.total,
      status: 'pending',
      sendAttempt: 1,
      breakdown,
    },
    { client: trx }
  )
  await AuditEvent.create(
    {
      entityType: 'vendor_payout',
      entityId: payout.id,
      eventType: 'created',
      userId: null,
      payload: { reason: 'payout_created', payoutUuid: payout.uuid, amount: payout.amount },
    },
    { client: trx }
  )
  return payout
}

/** Inside the delivery transition (shipment_tracking_service.ts) - starts the hold clock. */
export async function scheduleEligibility(
  orderId: number,
  deliveredAt: DateTime,
  trx: TransactionClientContract
): Promise<void> {
  const payout = await VendorPayout.query({ client: trx })
    .where('orderId', orderId)
    .where('status', 'pending')
    .preload('vendor')
    .first()
  if (!payout) {
    return
  }
  payout.useTransaction(trx)
  payout.eligibleAt = deliveredAt.plus({ days: payoutHoldDays(payout.vendor) })
  await payout.save()
}

/** The customer payments behind an order (normally one). */
async function orderPayments(order: Order, trx: TransactionClientContract): Promise<Payment[]> {
  if (!order.quoteId) {
    return []
  }
  const sessions = await CheckoutSession.query({ client: trx })
    .where('quoteId', order.quoteId)
    .select('id')
  const sessionIds = sessions.map((session) => session.id)
  if (sessionIds.length === 0) {
    return []
  }
  return Payment.query({ client: trx }).whereIn('checkoutSessionId', sessionIds)
}

export type ProcessSummary = { claimed: number; cancelled: number; recovered: number }

/** The scheduled job's entry point (see app/jobs/process_vendor_payouts.ts). */
export async function processDuePayouts(now: DateTime = DateTime.now()): Promise<ProcessSummary> {
  const summary: ProcessSummary = { claimed: 0, cancelled: 0, recovered: 0 }

  // An order refunded in full or cancelled never pays out, whatever stage
  // its payout reached short of being sent.
  const deadIds = await VendorPayout.query()
    .whereIn('status', ['pending', 'held'])
    .whereHas('order', (query) => query.whereIn('status', ['refunded', 'cancelled']))
    .select('id')
  for (const { id } of deadIds) {
    if (await cancelForDeadOrder(id)) summary.cancelled++
  }

  const dueIds = await VendorPayout.query()
    .where('status', 'pending')
    .whereNotNull('eligibleAt')
    .where('eligibleAt', '<=', now.toSQL()!)
    .orderBy('eligibleAt', 'asc')
    .select('id')
  for (const { id } of dueIds) {
    if (await processPayout(id, now)) summary.claimed++
  }

  const stuckIds = await VendorPayout.query()
    .where('status', 'processing')
    .where('processingAt', '<', now.minus({ minutes: STUCK_PROCESSING_MINUTES }).toSQL()!)
    .select('id')
  for (const { id } of stuckIds) {
    await recoverProcessingPayout(id)
    summary.recovered++
  }

  return summary
}

async function cancelForDeadOrder(payoutId: number): Promise<boolean> {
  return db.transaction(async (trx) => {
    const payout = await VendorPayout.query({ client: trx })
      .where('id', payoutId)
      .forUpdate()
      .firstOrFail()
    if (payout.status !== 'pending' && payout.status !== 'held') {
      return false
    }
    const order = await Order.findOrFail(payout.orderId, { client: trx })
    if (order.status !== 'refunded' && order.status !== 'cancelled') {
      return false
    }
    payout.useTransaction(trx)
    payout.merge({ status: 'cancelled', cancelledAt: DateTime.now() })
    await payout.save()
    await audit(payout, `order_${order.status}`, null, {}, trx)
    return true
  })
}

/**
 * Claims one due payout and sends it. Returns false when the payout wasn't
 * sent this run (not due, held, cancelled, or already claimed elsewhere).
 */
export async function processPayout(
  payoutId: number,
  now: DateTime = DateTime.now()
): Promise<boolean> {
  const claim = await db.transaction(async (trx) => {
    const payout = await VendorPayout.query({ client: trx })
      .where('id', payoutId)
      .forUpdate()
      .firstOrFail()
    if (payout.status !== 'pending' || !payout.eligibleAt || payout.eligibleAt > now) {
      return null
    }
    payout.useTransaction(trx)

    const order = await Order.findOrFail(payout.orderId, { client: trx })
    if (order.status === 'refunded' || order.status === 'cancelled') {
      payout.merge({ status: 'cancelled', cancelledAt: DateTime.now() })
      await payout.save()
      await audit(payout, `order_${order.status}`, null, {}, trx)
      return null
    }
    if (order.status !== 'delivered') {
      return null
    }

    // Refunds and disputes an admin already reviewed (when releasing a
    // previous hold) don't hold the payout again - only newer ones do.
    const reviewedUntil = payout.releasedAt
    const payments = await orderPayments(order, trx)
    const paymentIds = payments.map((payment) => payment.id)
    const refunds = paymentIds.length
      ? await Refund.query({ client: trx }).whereIn('paymentId', paymentIds)
      : []
    const unreviewedRefunds = refunds.filter(
      (refund) => !reviewedUntil || !refund.createdAt || refund.createdAt > reviewedUntil
    )

    let holdReason: VendorPayout['holdReason'] = null
    if (unreviewedRefunds.length > 0) {
      holdReason = 'partial_refund'
    } else {
      for (const paymentId of paymentIds) {
        if (await hasOpenDispute(paymentId, trx, reviewedUntil)) {
          holdReason = 'open_dispute'
          break
        }
      }
    }

    const vendor = await Vendor.findOrFail(payout.vendorId, { client: trx })
    if (!holdReason && !isPayoutMethodReady(vendor)) {
      holdReason = vendor.payoutMethodError ? 'payout_method_invalid' : 'manual'
    }

    if (holdReason) {
      payout.merge({ status: 'held', holdReason })
      await payout.save()
      await audit(payout, 'payout_held', null, { holdReason }, trx)
      return null
    }

    payout.merge({
      status: 'processing',
      processingAt: DateTime.now(),
      provider: vendor.payoutProvider!,
    })
    await payout.save()
    await audit(payout, 'payout_processing', null, { provider: payout.provider }, trx)
    return { payout, vendor }
  })

  if (!claim) {
    return false
  }
  // Re-fetched so neither is bound to the claim's committed transaction.
  await sendClaimed(
    await VendorPayout.findOrFail(claim.payout.id),
    await Vendor.findOrFail(claim.vendor.id)
  )
  return true
}

async function sendClaimed(payout: VendorPayout, vendor: Vendor): Promise<void> {
  if (payout.provider === 'stripe') {
    try {
      await refreshStripeStatus(vendor)
    } catch (error) {
      // Couldn't reach Stripe - nothing sent; the stuck-processing sweep retries.
      logger.warn({ payoutUuid: payout.uuid, error: String(error) }, 'Stripe status refresh failed')
      return
    }
    if (!vendor.stripePayoutsEnabled) {
      await recordPayoutFailure(
        payout.id,
        'Stripe account can no longer receive payouts',
        'recipient'
      )
      return
    }
  }

  const destination = payoutDestination(vendor)
  if (!destination) {
    await recordPayoutFailure(payout.id, 'Vendor has no payout destination', 'recipient')
    return
  }

  let result: SendPayoutResult
  try {
    result = await getPayoutGateway().send({
      provider: payout.provider,
      destination,
      amount: payout.amount,
      idempotencyKey: payout.providerIdempotencyKey,
      description: `MakeXYZ payout ${payout.uuid}`,
    })
  } catch (error) {
    if (error instanceof PayoutGatewayError) {
      await recordPayoutFailure(payout.id, error.message, error.kind)
      return
    }
    // Ambiguous - the money may have moved. Stays 'processing' for
    // recoverProcessingPayout, which is safe thanks to the idempotency key.
    logger.error({ payoutUuid: payout.uuid, error: String(error) }, 'Payout send was interrupted')
    return
  }

  await recordSent(payout.id, result)
}

async function recordSent(payoutId: number, result: SendPayoutResult): Promise<void> {
  await db.transaction(async (trx) => {
    const payout = await VendorPayout.query({ client: trx })
      .where('id', payoutId)
      .forUpdate()
      .firstOrFail()
    if (payout.status !== 'processing') {
      return
    }
    payout.useTransaction(trx)
    payout.providerTransactionId = result.transactionId
    if (result.status === 'paid') {
      payout.merge({ status: 'paid', paidAt: DateTime.now() })
    }
    await payout.save()
    await audit(
      payout,
      result.status === 'paid' ? 'payout_paid' : 'payout_sent',
      null,
      { transactionId: result.transactionId },
      trx
    )
  })
}

/**
 * Finishes a payout interrupted mid-send: if the provider already has it,
 * record that; otherwise send again (the idempotency key makes a duplicate
 * impossible).
 */
async function recoverProcessingPayout(payoutId: number): Promise<void> {
  const payout = await VendorPayout.findOrFail(payoutId)
  const vendor = await Vendor.findOrFail(payout.vendorId)

  let existing: SendPayoutResult | null
  try {
    existing = await getPayoutGateway().findExisting(payout.provider, payout.providerIdempotencyKey)
  } catch (error) {
    logger.warn({ payoutUuid: payout.uuid, error: String(error) }, 'Payout lookup failed')
    return
  }
  if (existing) {
    await recordSent(payout.id, existing)
    return
  }

  // A PayPal payout already handed to PayPal just waits for its webhook.
  if (payout.provider === 'paypal' && payout.providerTransactionId) {
    return
  }

  payout.processingAt = DateTime.now()
  await payout.save()
  await sendClaimed(payout, vendor)
}

/**
 * Marks a payout failed. A 'recipient' failure means the vendor's own
 * account is the problem: the vendor is flagged, which blocks new
 * acceptances and holds their other due payouts until they reconnect
 * (see requeueAfterPayoutMethodFixed). 'platform' failures wait for an admin
 * retry. Also accepts 'paid' - PayPal can return a payout after reporting it
 * succeeded.
 */
export async function recordPayoutFailure(
  payoutId: number,
  reason: string,
  kind: PayoutFailureKind,
  trx?: TransactionClientContract
): Promise<void> {
  const run = async (client: TransactionClientContract) => {
    const payout = await VendorPayout.query({ client })
      .where('id', payoutId)
      .forUpdate()
      .firstOrFail()
    if (payout.status !== 'processing' && payout.status !== 'paid') {
      return
    }
    payout.useTransaction(client)
    payout.merge({
      status: 'failed',
      failureReason: reason,
      failureKind: kind,
      failedAt: DateTime.now(),
      paidAt: null,
    })
    await payout.save()
    await audit(payout, 'payout_failed', null, { failureReason: reason, failureKind: kind }, client)

    if (kind === 'recipient') {
      const vendor = await Vendor.findOrFail(payout.vendorId, { client })
      vendor.useTransaction(client)
      await flagPayoutMethodError(vendor, reason)
    }
  }
  await (trx ? run(trx) : db.transaction(run))
}

/**
 * Once a vendor fixes their payout account, everything that failed or was
 * held because of it goes back into the queue, due immediately - the next
 * job run pays it to the (possibly new) destination.
 */
export async function requeueAfterPayoutMethodFixed(vendor: Vendor): Promise<number> {
  return db.transaction(async (trx) => {
    const payouts = await VendorPayout.query({ client: trx })
      .where('vendorId', vendor.id)
      .where((query) => {
        query
          .where((failed) => failed.where('status', 'failed').where('failureKind', 'recipient'))
          .orWhere((held) =>
            held.where('status', 'held').where('holdReason', 'payout_method_invalid')
          )
      })
      .forUpdate()

    for (const payout of payouts) {
      payout.useTransaction(trx)
      payout.merge({
        status: 'pending',
        eligibleAt: DateTime.now(),
        holdReason: null,
        failureReason: null,
        failureKind: null,
        failedAt: null,
        // A failed attempt's idempotency key can't be reused; a held payout
        // was never sent, so it keeps its key.
        sendAttempt: payout.status === 'failed' ? payout.sendAttempt + 1 : payout.sendAttempt,
        providerTransactionId: payout.status === 'failed' ? null : payout.providerTransactionId,
      })
      await payout.save()
      await audit(payout, 'payout_requeued_after_account_fixed', null, {}, trx)
    }
    return payouts.length
  })
}

/** Admin: sends a held payout on the next run, optionally at a reduced amount. */
export async function releaseHeldPayout(
  payout: VendorPayout,
  adminUserId: number,
  amount?: number
): Promise<VendorPayout> {
  await db.transaction(async (trx) => {
    const locked = await VendorPayout.query({ client: trx })
      .where('id', payout.id)
      .forUpdate()
      .firstOrFail()
    if (locked.status !== 'held') {
      throw new PayoutNotActionableError(`Payout ${locked.uuid} is ${locked.status}, not held`)
    }
    locked.useTransaction(trx)

    if (amount !== undefined) {
      const amountCents = Math.round(amount * 100)
      if (amountCents <= 0 || amountCents > toCents(locked.breakdown.total)) {
        throw new InvalidPayoutAdjustmentError(
          `Adjusted amount must be more than 0 and at most ${locked.breakdown.total}`
        )
      }
      locked.breakdown = {
        ...locked.breakdown,
        adjustment: {
          previousAmount: locked.amount,
          amount: fromCents(amountCents),
          adjustedById: adminUserId,
          adjustedAt: DateTime.now().toISO()!,
        },
      }
      locked.amount = fromCents(amountCents)
    }

    const previousHoldReason = locked.holdReason
    locked.merge({
      status: 'pending',
      holdReason: null,
      eligibleAt: DateTime.now(),
      releasedAt: DateTime.now(),
    })
    await locked.save()
    await audit(
      locked,
      'payout_released',
      adminUserId,
      { previousHoldReason, amount: locked.amount },
      trx
    )
  })
  await payout.refresh()
  return payout
}

/** Admin: this payout will never be sent. */
export async function cancelPayout(
  payout: VendorPayout,
  adminUserId: number
): Promise<VendorPayout> {
  await db.transaction(async (trx) => {
    const locked = await VendorPayout.query({ client: trx })
      .where('id', payout.id)
      .forUpdate()
      .firstOrFail()
    if (!['pending', 'held', 'failed'].includes(locked.status)) {
      throw new PayoutNotActionableError(
        `Payout ${locked.uuid} is ${locked.status} and can't be cancelled`
      )
    }
    locked.useTransaction(trx)
    locked.merge({ status: 'cancelled', cancelledAt: DateTime.now() })
    await locked.save()
    await audit(locked, 'payout_cancelled', adminUserId, {}, trx)
  })
  await payout.refresh()
  return payout
}

/** Admin: re-queues a failed payout, due immediately - after the platform-side cause is fixed. */
export async function retryFailedPayout(
  payout: VendorPayout,
  adminUserId: number
): Promise<VendorPayout> {
  await db.transaction(async (trx) => {
    const locked = await VendorPayout.query({ client: trx })
      .where('id', payout.id)
      .forUpdate()
      .firstOrFail()
    if (locked.status !== 'failed') {
      throw new PayoutNotActionableError(`Payout ${locked.uuid} is ${locked.status}, not failed`)
    }
    locked.useTransaction(trx)
    locked.merge({
      status: 'pending',
      eligibleAt: DateTime.now(),
      failureReason: null,
      failureKind: null,
      failedAt: null,
      sendAttempt: locked.sendAttempt + 1,
      providerTransactionId: null,
    })
    await locked.save()
    await audit(locked, 'payout_retried', adminUserId, { sendAttempt: locked.sendAttempt }, trx)
  })
  await payout.refresh()
  return payout
}

/** PayPal item errors meaning the vendor's account can't take the payout. */
const PAYPAL_RECIPIENT_ERRORS = new Set([
  'RECEIVER_UNREGISTERED',
  'RECEIVER_ACCOUNT_LOCKED_OR_CLOSED',
  'RECEIVER_UNCONFIRMED',
  'RECEIVER_COUNTRY_NOT_ALLOWED',
  'RECEIVER_ACCOUNT_LIMITATION',
  'RECEIVER_YOUTH_ACCOUNT',
])

/**
 * Applies a PAYMENT.PAYOUTS-ITEM.* webhook (see paypal_webhooks_controller.ts),
 * inside the webhook's transaction. Matched by sender_item_id, which is the
 * payout uuid.
 */
export async function applyPaypalPayoutItemEvent(
  eventType: string,
  resource: Record<string, any>,
  trx: TransactionClientContract
): Promise<void> {
  const senderItemId = resource.payout_item?.sender_item_id
  if (typeof senderItemId !== 'string') {
    return
  }
  // sender_item_id is the attempt's idempotency key: the payout uuid,
  // suffixed on retries.
  const payout = await VendorPayout.query({ client: trx })
    .where('uuid', senderItemId.slice(0, 36))
    .forUpdate()
    .first()
  if (!payout) {
    return
  }
  // A late event about an earlier, already-failed attempt must not touch
  // the attempt now in flight.
  if (senderItemId !== payout.providerIdempotencyKey) {
    logger.info(
      { payoutUuid: payout.uuid, senderItemId, eventType },
      'Ignoring a PayPal payout event for a superseded attempt'
    )
    return
  }
  const itemId: string | null = resource.payout_item_id ?? null
  const status = eventType.replace('PAYMENT.PAYOUTS-ITEM.', '')

  if (status === 'SUCCEEDED') {
    if (payout.status !== 'processing') {
      return
    }
    payout.useTransaction(trx)
    payout.merge({
      status: 'paid',
      paidAt: DateTime.now(),
      providerTransactionId: itemId ?? payout.providerTransactionId,
    })
    await payout.save()
    await audit(payout, 'payout_paid', null, { transactionId: itemId }, trx)
    return
  }

  if (!['FAILED', 'RETURNED', 'BLOCKED', 'DENIED', 'UNCLAIMED'].includes(status)) {
    return
  }

  const errorName: string | null = resource.errors?.name ?? null
  if (status === 'UNCLAIMED' && itemId) {
    // Pull the money back now rather than after PayPal's 30-day window.
    try {
      await getPayoutGateway().cancelUnclaimedPaypalItem(itemId)
    } catch (error) {
      logger.error(
        { payoutUuid: payout.uuid, itemId, error: String(error) },
        'Cancelling an unclaimed PayPal payout failed - it will be returned after 30 days'
      )
    }
  }

  const kind: PayoutFailureKind =
    status === 'UNCLAIMED' ||
    status === 'RETURNED' ||
    (errorName && PAYPAL_RECIPIENT_ERRORS.has(errorName))
      ? 'recipient'
      : 'platform'
  const reason = `PayPal payout ${status.toLowerCase()}${errorName ? ` (${errorName})` : ''}`

  if (itemId) {
    payout.useTransaction(trx)
    payout.providerTransactionId = itemId
    await payout.save()
  }
  await recordPayoutFailure(payout.id, reason, kind, trx)
}
