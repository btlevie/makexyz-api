/**
 * When a part's manufacturing technology may no longer be changed.
 *
 * The hazard is money being committed, not a quote merely existing. Instant
 * quotes are auto-generated as `draft` and never sent, so a customer stays free
 * to switch technology right up until they check out - which is the point at
 * which changing the part would mean paying for one thing and receiving another.
 *
 * Kept as a service rather than inline in the controller so the checkout flow can
 * reuse the same predicate instead of re-deriving it.
 */
import CheckoutSession from '#models/checkout_session'
import Order from '#models/order'
import type ProjectFile from '#models/project_file'
import Quote from '#models/quote'

/** A checkout in either of these states has pricing committed behind it. */
const CHECKOUT_STATUSES_LOCKING_TECHNOLOGY = ['active', 'completed'] as const

/**
 * Quote states meaning a real price has been put in front of someone. `draft` is
 * the instant-quote default and has been seen by nobody but the visitor
 * themselves; `rejected` is dead, and switching technology to chase a better
 * price is a reasonable response to a rejection rather than something to prevent.
 */
const QUOTE_STATUSES_LOCKING_TECHNOLOGY = ['sent', 'accepted'] as const

/**
 * Once a vendor has started making the part, a technology change is a new
 * order, not a correction - unlike the two locks below, this one is not
 * overridable even by staff (see findTechnologyLock's `overridable` field).
 */
const ORDER_STATUSES_LOCKING_TECHNOLOGY = [
  'in_progress',
  'ready_to_ship',
  'shipped',
  'delivered',
] as const

export type TechnologyLock = {
  reason: 'checkout_started' | 'quote_presented' | 'order_in_production'
  description: string
  overridable: boolean
}

export async function findTechnologyLock(
  projectFile: ProjectFile
): Promise<TechnologyLock | null> {
  // Project-level, and checked first, on purpose: once production has
  // started nothing - not even staff - should be able to swap the part out
  // from under it. Payment is not the right line to draw with instant
  // quotes (checkout pays immediately) - production actually starting is.
  if (projectFile.projectId) {
    const order = await Order.query()
      .where('projectId', projectFile.projectId)
      .whereIn('status', [...ORDER_STATUSES_LOCKING_TECHNOLOGY])
      .first()

    if (order) {
      return {
        reason: 'order_in_production',
        description: `order ${order.uuid} is already in production (${order.status})`,
        overridable: false,
      }
    }
  }

  // Project-level on purpose: you cannot swap one part out from under a checkout
  // covering the whole basket.
  if (projectFile.projectId) {
    const checkoutSession = await CheckoutSession.query()
      .where('projectId', projectFile.projectId)
      .whereIn('status', [...CHECKOUT_STATUSES_LOCKING_TECHNOLOGY])
      .first()

    if (checkoutSession) {
      return {
        reason: 'checkout_started',
        description: `checkout has already started for this project (session ${checkoutSession.id}, ${checkoutSession.status})`,
        overridable: true,
      }
    }
  }

  // File-level: a part left off a partial quote, or added after one, was never
  // presented and stays editable.
  const quote = await Quote.query()
    .whereIn('status', [...QUOTE_STATUSES_LOCKING_TECHNOLOGY])
    .whereHas('items', (items) => items.where('project_file_id', projectFile.id))
    .orderBy('revision', 'desc')
    .first()

  if (quote) {
    return {
      reason: 'quote_presented',
      description: `it is on quote ${quote.uuid} (${quote.status})`,
      overridable: true,
    }
  }

  return null
}
