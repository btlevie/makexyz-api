/**
 * How a vendor gets paid: Stripe Connect (Express) or PayPal, chosen by the
 * vendor. A vendor must have a ready payout method before they can accept an
 * order (see order_acceptance_service.ts), so a payout can never come due
 * with nowhere to send it.
 *
 * Account identifiers are only ever obtained from the provider, never typed
 * in by the vendor:
 *   - Stripe: the server creates the Express account and stores its
 *     `acct_...` id on the vendor before handing back the onboarding link.
 *   - PayPal: the vendor signs in with PayPal (Log in with PayPal) and the
 *     verified payer_id it returns is stored - PayPal has no way to verify a
 *     typed email belongs to a live account.
 *
 * Switching rails keeps the other rail's account, so switching back doesn't
 * need re-onboarding.
 */
import { DateTime } from 'luxon'
import encryption from '@adonisjs/core/services/encryption'
import string from '@adonisjs/core/helpers/string'
import Vendor from '#models/vendor'
import { getStripeConnectClient } from '#services/stripe_connect_service'
import { getPaypalIdentityClient, PaypalIdentityError } from '#services/paypal_identity_service'
import { requeueAfterPayoutMethodFixed } from '#services/vendor_payout_service'

const PAYPAL_CONNECT_PURPOSE = 'vendor-paypal-connect'

export class PayoutMethodNotReadyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayoutMethodNotReadyError'
  }
}

/** The PayPal callback's state is missing, expired, tampered with, or another vendor's. */
export class PaypalConnectStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaypalConnectStateError'
  }
}

/** The PayPal account can't receive payouts (unverified, or PayPal returned no payer id). */
export class PaypalAccountNotEligibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaypalAccountNotEligibleError'
  }
}

/** The PayPal account is already connected to a different vendor. */
export class PayoutAccountInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayoutAccountInUseError'
  }
}

export type PayoutMethodStatus = 'needs_setup' | 'ready' | 'needs_attention'

export function isPayoutMethodReady(vendor: Vendor): boolean {
  if (vendor.payoutMethodError) {
    return false
  }
  if (vendor.payoutProvider === 'stripe') {
    return !!vendor.stripeAccountId && !!vendor.stripePayoutsEnabled
  }
  if (vendor.payoutProvider === 'paypal') {
    return !!vendor.paypalPayerId
  }
  return false
}

export function payoutMethodStatus(vendor: Vendor): PayoutMethodStatus {
  if (vendor.payoutMethodError) {
    return 'needs_attention'
  }
  return isPayoutMethodReady(vendor) ? 'ready' : 'needs_setup'
}

/** Where a payout to this vendor goes on their current rail. */
export function payoutDestination(vendor: Vendor): string | null {
  if (vendor.payoutProvider === 'stripe') return vendor.stripeAccountId
  if (vendor.payoutProvider === 'paypal') return vendor.paypalPayerId
  return null
}

export function assertPayoutMethodReady(vendor: Vendor): void {
  if (!isPayoutMethodReady(vendor)) {
    const reason =
      payoutMethodStatus(vendor) === 'needs_attention'
        ? `your payout account needs attention (${vendor.payoutMethodError})`
        : 'you have not finished setting up how you get paid'
    throw new PayoutMethodNotReadyError(`Can't accept orders yet: ${reason}`)
  }
}

/**
 * Returns a fresh Stripe onboarding link. The Express account is created -
 * and its id saved on the vendor - before the link is built, so a vendor who
 * abandons onboarding halfway resumes with the same account.
 */
export async function startStripeOnboarding(vendor: Vendor): Promise<string> {
  const client = getStripeConnectClient()

  if (!vendor.stripeAccountId) {
    await vendor.load('user')
    const { accountId } = await client.createExpressAccount({
      email: vendor.user?.email ?? null,
      vendorUuid: vendor.uuid,
    })
    vendor.stripeAccountId = accountId
    vendor.stripePayoutsEnabled = false
  }
  vendor.payoutProvider = 'stripe'
  await vendor.save()

  return client.createOnboardingLink(vendor.stripeAccountId!)
}

/**
 * Re-reads the connected account's payouts_enabled - called when the vendor
 * comes back from onboarding (GET /v1/vendor/payout-method) and before every
 * Stripe transfer. A vendor whose payouts were failing is recovered here once
 * Stripe says the account can receive them again.
 */
export async function refreshStripeStatus(vendor: Vendor): Promise<Vendor> {
  if (!vendor.stripeAccountId) {
    return vendor
  }

  const { payoutsEnabled } = await getStripeConnectClient().retrieveAccount(vendor.stripeAccountId)
  vendor.stripePayoutsEnabled = payoutsEnabled

  const recovered =
    payoutsEnabled && vendor.payoutProvider === 'stripe' && !!vendor.payoutMethodError
  if (recovered) {
    vendor.payoutMethodError = null
    vendor.payoutMethodErrorAt = null
  }
  await vendor.save()

  if (recovered) {
    await requeueAfterPayoutMethodFixed(vendor)
  }
  return vendor
}

/**
 * The Log in with PayPal URL. `state` is encrypted and expires, binding the
 * callback to this vendor - it's also the CSRF guard.
 */
export function startPaypalConnect(vendor: Vendor): string {
  const state = String(
    encryption.encrypt(
      { vendorId: vendor.id, nonce: string.random(16) },
      '10 minutes',
      PAYPAL_CONNECT_PURPOSE
    )
  )
  return getPaypalIdentityClient().buildAuthorizeUrl(state)
}

export async function completePaypalConnect(
  vendor: Vendor,
  code: string,
  state: string
): Promise<Vendor> {
  const decoded = encryption.decrypt<{ vendorId: number }>(state, PAYPAL_CONNECT_PURPOSE)
  if (!decoded || decoded.vendorId !== vendor.id) {
    throw new PaypalConnectStateError('PayPal sign-in expired or is invalid - please try again')
  }

  let identity
  try {
    identity = await getPaypalIdentityClient().fetchIdentity(code)
  } catch (error) {
    if (error instanceof PaypalIdentityError) {
      throw new PaypalAccountNotEligibleError(
        `Couldn't verify your PayPal account: ${error.message}`
      )
    }
    throw error
  }

  if (!identity.payerId || !identity.verifiedAccount) {
    throw new PaypalAccountNotEligibleError(
      'This PayPal account is not verified - verify it with PayPal, then connect it again'
    )
  }

  const takenBy = await Vendor.query()
    .where('paypalPayerId', identity.payerId)
    .whereNot('id', vendor.id)
    .first()
  if (takenBy) {
    throw new PayoutAccountInUseError('This PayPal account is already connected to another vendor')
  }

  const hadError = !!vendor.payoutMethodError
  vendor.merge({
    paypalPayerId: identity.payerId,
    paypalEmail: identity.email,
    payoutProvider: 'paypal',
    payoutMethodError: null,
    payoutMethodErrorAt: null,
  })
  await vendor.save()

  if (hadError) {
    await requeueAfterPayoutMethodFixed(vendor)
  }
  return vendor
}

/** Records that a payout failed because of the vendor's own account. */
export async function flagPayoutMethodError(vendor: Vendor, reason: string): Promise<void> {
  vendor.payoutMethodError = reason.slice(0, 255)
  vendor.payoutMethodErrorAt = DateTime.now()
  await vendor.save()

  // TODO(mail): tell the vendor a payout couldn't be sent to their account
  // (`reason`), that new order acceptance is blocked, and that reconnecting
  // their payout account re-queues everything held.
}
