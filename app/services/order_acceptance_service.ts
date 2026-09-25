/**
 * Vendor acceptance - the step that actually captures payment (see
 * checkout_service#captureCheckoutSession). Everything here is about one
 * order transitioning from 'open' to 'accepted' exactly once, even when more
 * than one eligible vendor races for it.
 */
import db from '@adonisjs/lucid/services/db'
import Order from '#models/order'
import OrderStatusHistory from '#models/order_status_history'
import Vendor from '#models/vendor'
import { captureCheckoutSession } from '#services/checkout_service'
import { vendorCanAcceptOrder } from '#services/order_routing_service'
import { computePayoutBreakdown } from '#services/payout_calculation_service'
import { assertPayoutMethodReady } from '#services/vendor_payout_method_service'
import { hasCurrentAgreement } from '#services/vendor_onboarding_service'
import { createPayoutForAcceptedOrder } from '#services/vendor_payout_service'

export class VendorNotEligibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VendorNotEligibleError'
  }
}

export class OrderNotAvailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderNotAvailableError'
  }
}

/**
 * Eligibility check as a query, not a mutation - same rule acceptOrder uses,
 * for a vendor's "what can I accept right now" listing.
 */
export async function listAcceptableOrders(vendor: Vendor): Promise<Order[]> {
  // vendorCanAcceptOrder would say no to every order anyway (it only counts
  // active vendors) - this just skips the per-order queries.
  if (vendor.status !== 'active') {
    return []
  }

  // Candidates are any unaccepted open order, regardless of routing stage -
  // vendorCanAcceptOrder is what actually applies the preferred/open
  // eligibility rule per order below.
  const candidates = await Order.query()
    .where('status', 'open')
    .whereNull('vendorId')
    .orderBy('createdAt', 'asc')

  const acceptable: Order[] = []
  for (const order of candidates) {
    if (await vendorCanAcceptOrder(vendor.id, order)) {
      acceptable.push(order)
    }
  }
  return acceptable
}

/**
 * Accepts an order on the vendor's behalf, then triggers payment capture.
 * Guards against two eligible vendors racing for the same order via a
 * conditional update (`WHERE status = 'open' AND vendor_id IS NULL`) rather
 * than a plain read-then-write, which both preferred-stage and open-stage
 * vendors can otherwise hit since eligibility isn't exclusive to one vendor.
 *
 * The order's status flips to 'accepted' *before* capture is attempted - that
 * atomic transition is the actual race boundary against both a second vendor
 * and the checkout-expiration job (checkout_service#expireCheckoutSession).
 * Capture itself is guarded separately, by the payment's own status, not the
 * order's - see checkout_service#captureCheckoutSession.
 *
 * Acceptance also fixes what the vendor will be paid: the vendor must have a
 * ready payout method (PayoutMethodNotReadyError) and a payout rate for every
 * item's material (PayoutRateMissingError), and the payout snapshot is
 * created in the same transaction as the status flip.
 *
 * The vendor must also be active with approved capabilities (checked inside
 * vendorCanAcceptOrder) and on the current vendor agreement version - a
 * version bump blocks new acceptances until they re-accept, without
 * deactivating them (see docs/VENDOR_ONBOARDING.md).
 */
export async function acceptOrder(order: Order, vendor: Vendor, userId: number): Promise<Order> {
  if (!hasCurrentAgreement(vendor)) {
    throw new VendorNotEligibleError('Accept the current vendor agreement before accepting orders')
  }

  const eligible = await vendorCanAcceptOrder(vendor.id, order)
  if (!eligible) {
    throw new VendorNotEligibleError(
      `Vendor ${vendor.uuid} is not eligible to accept order ${order.uuid}`
    )
  }

  assertPayoutMethodReady(vendor)

  const previousStatus = order.status

  await db.transaction(async (trx) => {
    // Before the status flip, so a missing rate leaves the order open for
    // another vendor.
    const breakdown = await computePayoutBreakdown(order, vendor, trx)

    const updatedCount = await Order.query({ client: trx })
      .where('id', order.id)
      .where('status', 'open')
      .whereNull('vendorId')
      .update({ vendor_id: vendor.id, status: 'accepted' })
      .then((result) => Number(result) || 0)

    if (updatedCount === 0) {
      throw new OrderNotAvailableError(`Order ${order.uuid} is no longer available to accept`)
    }

    await createPayoutForAcceptedOrder(order, vendor, breakdown, trx)

    await OrderStatusHistory.create(
      {
        orderId: order.id,
        oldStatus: previousStatus,
        newStatus: 'accepted',
        changedById: userId,
      },
      { client: trx }
    )
  })

  await order.refresh()
  await captureCheckoutSession(order)
  await order.refresh()

  return order
}
