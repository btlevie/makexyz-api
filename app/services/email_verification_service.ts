/**
 * Proving an account holder owns their email address.
 *
 * Signup never checks the address, so anyone can create an account under an
 * email they don't control. That's harmless for quoting and checkout, but
 * messaging vendors is where cheap throwaway accounts turn into spam - so an
 * inquiry needs a verified email (see docs/plans/messaging_moderation.md).
 *
 * Same link shape as guest claims: an AdonisJS signed URL, opened while signed
 * in to the account it was issued for. The signature covers a hash of the
 * email as well as the user uuid, so if the account's email ever changes, a
 * link sent to the old address stops working.
 */
import { createHash } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import { signedUrlFor } from '@adonisjs/core/services/url_builder'
import mail from '@adonisjs/mail/services/main'
import { DateTime } from 'luxon'
import env from '#start/env'
import EmailVerificationNotification from '#mails/email_verification_notification'
import type User from '#models/user'
import { normalizeEmail } from '#services/invitation_service'

/** Signature purpose for the confirm route - request.hasValidSignature(EMAIL_VERIFICATION_SIGNATURE_PURPOSE). */
export const EMAIL_VERIFICATION_SIGNATURE_PURPOSE = 'email_verification'

const EMAIL_VERIFICATION_LINK_TTL = '24 hours'

/** Short, stable fingerprint of an email for the signed route - never the email itself. */
export function emailFingerprint(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 32)
}

/** The signed API path the verification page POSTs to. */
export function signedVerificationPath(user: User): string {
  return signedUrlFor(
    'profile.email_verifications.confirm',
    { userUuid: user.uuid, emailHash: emailFingerprint(user.email) },
    { expiresIn: EMAIL_VERIFICATION_LINK_TTL, purpose: EMAIL_VERIFICATION_SIGNATURE_PURPOSE }
  )
}

function verificationUrlFor(user: User): string {
  const path = signedVerificationPath(user)
  const page = env.get('ACCOUNT_VERIFY_EMAIL_URL')
  return page ? `${page}?link=${encodeURIComponent(path)}` : path
}

export function isEmailVerified(user: User): boolean {
  return user.emailVerifiedAt !== null && user.emailVerifiedAt !== undefined
}

/**
 * Emails a verification link unless the address is already verified.
 * Best-effort: never throws, so a mail outage can't fail signup. Returns
 * whether a link was sent.
 */
export async function sendVerificationEmail(user: User): Promise<boolean> {
  if (isEmailVerified(user)) {
    return false
  }

  try {
    await mail.send(new EmailVerificationNotification(user.email, verificationUrlFor(user)))
    logger.info({ userUuid: user.uuid }, 'Sent an email verification link')
    return true
  } catch (error) {
    logger.error(
      { userUuid: user.uuid, error: String(error) },
      'Failed to send an email verification link'
    )
    return false
  }
}

/** Idempotent - verifying twice keeps the original timestamp. */
export async function markEmailVerified(user: User): Promise<User> {
  if (!isEmailVerified(user)) {
    user.emailVerifiedAt = DateTime.now()
    await user.save()
  }
  return user
}
