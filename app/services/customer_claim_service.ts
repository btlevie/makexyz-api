/**
 * Moving guest work onto a real account.
 *
 * A guest (lead) customer - `user_id` null, see lead_customer_service.ts -
 * owns projects, quote addresses, checkout sessions and orders before the
 * person ever signs up. When they do, that work has to follow them. Matching
 * by email alone is unsafe (anyone can sign up with someone else's email), so
 * each entry point here is only ever called once the caller has proven
 * something:
 *
 * - claimProject: the signup request carried that project's grant (same
 *   browser) - proves this one project, nothing about the guest's others.
 * - mergeGuestCustomer: a signed link sent to the guest's email was opened by
 *   the logged-in account holder - proves the whole guest record.
 *
 * Both only ever take from a guest customer, never from another account.
 */
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Address from '#models/address'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Order from '#models/order'
import Project from '#models/project'
import Quote from '#models/quote'

export class GuestClaimNotAllowedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuestClaimNotAllowedError'
  }
}

export type GuestMergeResult = { projects: number; orders: number }

/** Whether a customer row is a guest lead (no account behind it). */
function isGuest(customer: Customer): boolean {
  return !customer.userId
}

/**
 * Attaches one project - and the orders, checkout sessions and quote
 * addresses that hang off it - to `customer`. No-op when the project is
 * already theirs. Throws GuestClaimNotAllowedError if the project belongs to
 * another account.
 */
export async function claimProject(
  project: Project,
  customer: Customer,
  trx: TransactionClientContract
): Promise<void> {
  const locked = await Project.query({ client: trx })
    .where('id', project.id)
    .forUpdate()
    .firstOrFail()
  const previousCustomerId = locked.customerId
  if (previousCustomerId === customer.id) {
    return
  }
  if (previousCustomerId !== null) {
    const previous = await Customer.query({ client: trx })
      .where('id', previousCustomerId)
      .firstOrFail()
    if (!isGuest(previous)) {
      throw new GuestClaimNotAllowedError(`Project ${project.uuid} belongs to another account`)
    }
  }

  locked.customerId = customer.id
  await locked.save()
  project.customerId = customer.id

  const fromPrevious = (query: any) =>
    previousCustomerId === null
      ? query.whereNull('customer_id')
      : query.where((q: any) =>
          q.whereNull('customer_id').orWhere('customer_id', previousCustomerId)
        )

  await fromPrevious(Order.query({ client: trx }).where('project_id', project.id)).update({
    customer_id: customer.id,
  })
  await fromPrevious(CheckoutSession.query({ client: trx }).where('project_id', project.id)).update(
    { customer_id: customer.id }
  )

  const quoteAddressIds = Quote.query({ client: trx })
    .where('project_id', project.id)
    .whereNotNull('address_id')
    .select('address_id')
  await fromPrevious(Address.query({ client: trx }).whereIn('id', quoteAddressIds)).update({
    customer_id: customer.id,
  })
}

/**
 * Moves everything a guest customer owns onto `customer`, carries over the
 * more recent marketing choice, and deletes the now-empty guest row. Throws
 * GuestClaimNotAllowedError if `guest` has since become (or always was) an
 * account.
 */
export async function mergeGuestCustomer(
  guest: Customer,
  customer: Customer
): Promise<GuestMergeResult> {
  return db.transaction(async (trx) => {
    const lockedGuest = await Customer.query({ client: trx })
      .where('id', guest.id)
      .forUpdate()
      .first()
    if (!lockedGuest || !isGuest(lockedGuest)) {
      throw new GuestClaimNotAllowedError(`Customer ${guest.uuid} is not a guest customer`)
    }
    if (lockedGuest.id === customer.id) {
      throw new GuestClaimNotAllowedError('Cannot merge a customer into itself')
    }

    const projects = await Project.query({ client: trx }).where('customer_id', lockedGuest.id)
    const orders = await Order.query({ client: trx }).where('customer_id', lockedGuest.id)

    const moveTo = { customer_id: customer.id }
    await Project.query({ client: trx }).where('customer_id', lockedGuest.id).update(moveTo)
    await Order.query({ client: trx }).where('customer_id', lockedGuest.id).update(moveTo)
    await Address.query({ client: trx }).where('customer_id', lockedGuest.id).update(moveTo)
    await CheckoutSession.query({ client: trx }).where('customer_id', lockedGuest.id).update(moveTo)

    // The most recent explicit choice wins - both come from the same
    // (now verified) person.
    const guestChoiceAt = lockedGuest.marketingOptInUpdatedAt
    const accountChoiceAt = customer.marketingOptInUpdatedAt
    if (guestChoiceAt && (!accountChoiceAt || guestChoiceAt > accountChoiceAt)) {
      customer.useTransaction(trx)
      customer.marketingOptIn = lockedGuest.marketingOptIn
      customer.marketingOptInUpdatedAt = guestChoiceAt
      await customer.save()
    }

    // Nothing references the guest any more - checkout_sessions (the only
    // cascading FK) were moved above.
    await lockedGuest.delete()

    return { projects: projects.length, orders: orders.length }
  })
}
