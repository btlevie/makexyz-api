/**
 * Verified-email claiming of guest work (see customer_claim_service.ts).
 *
 * When an account holder's email matches a guest customer, we email that
 * address a signed link. Opening it while signed in to the account merges the
 * guest's projects/orders into it. The link is an AdonisJS signed URL over the
 * guest customer and user uuids (no email in the URL); it expires, and it
 * effectively works once because the merge deletes the guest row. Same link
 * shape as invitations: `${ACCOUNT_CLAIM_URL}?link=<signed API path>`.
 */
import logger from '@adonisjs/core/services/logger'
import { signedUrlFor } from '@adonisjs/core/services/url_builder'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import GuestClaimNotification from '#mails/guest_claim_notification'
import Customer from '#models/customer'
import Project from '#models/project'
import type User from '#models/user'
import { normalizeEmail } from '#services/invitation_service'

/** Signature purpose for the confirm route - request.hasValidSignature(GUEST_CLAIM_SIGNATURE_PURPOSE). */
export const GUEST_CLAIM_SIGNATURE_PURPOSE = 'guest_claim'

const GUEST_CLAIM_LINK_TTL = '24 hours'

/** The guest customer holding work under this email, if any. */
export async function findClaimableGuest(email: string): Promise<Customer | null> {
  const guest = await Customer.query()
    .where('email', normalizeEmail(email))
    .whereNull('user_id')
    .first()
  if (!guest) {
    return null
  }

  const project = await Project.query().where('customer_id', guest.id).first()
  return project ? guest : null
}

/** The signed API path the claim page POSTs to. */
export function signedClaimPath(guest: Customer, user: User): string {
  return signedUrlFor(
    'profile.guest_claims.confirm',
    { customerUuid: guest.uuid, userUuid: user.uuid },
    { expiresIn: GUEST_CLAIM_LINK_TTL, purpose: GUEST_CLAIM_SIGNATURE_PURPOSE }
  )
}

function claimUrlFor(guest: Customer, user: User): string {
  const path = signedClaimPath(guest, user)
  const page = env.get('ACCOUNT_CLAIM_URL')
  return page ? `${page}?link=${encodeURIComponent(path)}` : path
}

/**
 * Emails a claim link to the user's address if a guest customer holds work
 * under it. Best-effort: never throws, so a mail outage can't fail signup.
 * Returns whether a link was sent.
 */
export async function sendGuestClaimEmail(user: User): Promise<boolean> {
  try {
    const guest = await findClaimableGuest(user.email)
    if (!guest) {
      return false
    }

    await mail.send(new GuestClaimNotification(guest.email!, claimUrlFor(guest, user)))
    logger.info({ userUuid: user.uuid, customerUuid: guest.uuid }, 'Sent a guest claim link')
    return true
  } catch (error) {
    logger.error({ userUuid: user.uuid, error: String(error) }, 'Failed to send a guest claim link')
    return false
  }
}
