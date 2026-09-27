/**
 * Guest ("lead") customers for anonymous instant-quote projects.
 *
 * A visitor who never signs up still becomes a Customer the moment they give
 * us an email - on configure (alongside the shipping address), via "email
 * this quote to me", or at checkout. That row has no user account (`user_id`
 * stays null) and is shared by every project the same email is given for.
 *
 * Every path here is public and unverified - anyone holding a project grant
 * can type any email - so it never reassigns an owned project and never
 * touches a customer that belongs to a real account.
 */
import string from '@adonisjs/core/helpers/string'
import { DateTime } from 'luxon'
import Customer from '#models/customer'
import type Project from '#models/project'
import { normalizeEmail } from '#services/invitation_service'

/**
 * Attaches a guest customer for `email` to a project that has none yet, and
 * records the marketing choice when one is given.
 *
 * - An owned project keeps its owner; `email` then only identifies whose
 *   consent is being recorded.
 * - `marketingOptIn` is the latest explicit choice (true or false); omitting
 *   it leaves consent unchanged. It only applies to a guest customer whose
 *   own email was submitted - never to an account (unverified public request)
 *   and never to a different lead's row.
 *
 * Returns the project's customer (or null when an owned project's owner can't
 * be loaded, which shouldn't happen).
 */
export async function attachLeadCustomer(
  project: Project,
  email: string,
  marketingOptIn?: boolean
): Promise<Customer | null> {
  const normalizedEmail = normalizeEmail(email)

  let customer: Customer | null
  if (project.customerId) {
    customer = await Customer.find(project.customerId)
  } else {
    customer = await Customer.firstOrCreate(
      { email: normalizedEmail },
      { email: normalizedEmail, uuid: string.uuid() }
    )
    project.customerId = customer.id
    await project.save()
  }

  if (
    customer &&
    marketingOptIn !== undefined &&
    !customer.userId &&
    customer.email === normalizedEmail
  ) {
    await recordMarketingChoice(customer, marketingOptIn)
  }

  return customer
}

/**
 * Stores a guest's opt-in choice, stamping when it changed - the timestamp is
 * the evidence of when consent was given or withdrawn.
 */
async function recordMarketingChoice(customer: Customer, marketingOptIn: boolean) {
  if (customer.marketingOptIn === marketingOptIn && customer.marketingOptInUpdatedAt) {
    return
  }

  customer.marketingOptIn = marketingOptIn
  customer.marketingOptInUpdatedAt = DateTime.now()
  await customer.save()
}
