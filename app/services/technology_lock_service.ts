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

export type TechnologyLock = {
  reason: 'checkout_started' | 'quote_presented'
  description: string
}

export async function findTechnologyLock(
  projectFile: ProjectFile
): Promise<TechnologyLock | null> {
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
    }
  }

  return null
}
