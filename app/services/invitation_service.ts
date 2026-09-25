/**
 * Admin invitations: how every vendor (and, later, admin) account comes into
 * existence. See docs/VENDOR_ONBOARDING.md for the full flow.
 *
 * The user row is only created when the invitee accepts and chooses their own
 * password - so users.password is never null and there are no half-created
 * accounts. Until then the invitation row holds the email and role.
 *
 * Links are AdonisJS signed URLs over the invitation uuid (no email or other
 * personal data in the URL). The signature proves the link came from us and
 * hasn't expired; single use and revocation come from the invitation row's
 * own state, which both the show and accept endpoints check - signed URLs are
 * stateless and can't be revoked on their own.
 */
import db from '@adonisjs/lucid/services/db'
import string from '@adonisjs/core/helpers/string'
import { signedUrlFor } from '@adonisjs/core/services/url_builder'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import env from '#start/env'
import AuditEvent from '#models/audit_event'
import Invitation, { type InvitationStatus } from '#models/invitation'
import User from '#models/user'
import Vendor from '#models/vendor'

/** How long an invitation (and each link issued for it) stays valid. */
const INVITATION_TTL_DAYS = 7

/**
 * The accept link handed back by the show endpoint. Short, since the page
 * that uses it has just been loaded - a page left open longer re-fetches.
 */
const ACCEPT_LINK_TTL = '1 hour'

/** Signature purpose for both invitation routes - request.hasValidSignature(INVITATION_SIGNATURE_PURPOSE). */
export const INVITATION_SIGNATURE_PURPOSE = 'invitation'

/** The email already belongs to a user - one user has one role, so no invite or conversion. */
export class EmailInUseError extends Error {
  constructor(
    message: string,
    readonly existingRole: User['role'],
    readonly vendorUuid: string | null
  ) {
    super(message)
    this.name = 'EmailInUseError'
  }
}

export class InvitationNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvitationNotFoundError'
  }
}

/** The invitation can't be used (or acted on) in its current status. */
export class InvitationNotPendingError extends Error {
  constructor(
    message: string,
    readonly status: InvitationStatus
  ) {
    super(message)
    this.name = 'InvitationNotPendingError'
  }
}

export type IssuedInvitation = {
  invitation: Invitation
  /** What the admin shares (until mail exists): the frontend invite page carrying the signed API link. */
  inviteUrl: string
}

/** Emails are stored and compared trimmed + lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Case-insensitive, since pre-existing users.email values weren't normalized. */
function findUserByEmail(email: string, trx?: TransactionClientContract) {
  return User.query(trx ? { client: trx } : {})
    .whereRaw('lower(email) = ?', [normalizeEmail(email)])
    .first()
}

async function assertEmailFree(email: string, trx?: TransactionClientContract): Promise<void> {
  const existing = await findUserByEmail(email, trx)
  if (!existing) return

  const vendor = existing.role === 'vendor' ? await Vendor.findBy('userId', existing.id) : null
  throw new EmailInUseError(
    existing.role === 'vendor'
      ? `${email} is already a vendor`
      : `${email} already belongs to a ${existing.role} account - invite a separate email instead`,
    existing.role,
    vendor?.uuid ?? null
  )
}

/** The signed API path for viewing an invitation - what the invite page receives. */
function signedShowPath(invitation: Invitation): string {
  return signedUrlFor(
    'auth.invitations.show',
    { uuid: invitation.uuid },
    { expiresIn: `${INVITATION_TTL_DAYS} days`, purpose: INVITATION_SIGNATURE_PURPOSE }
  )
}

/** The signed API path the invite page POSTs the password to. */
export function signedAcceptPath(invitation: Invitation): string {
  return signedUrlFor(
    'auth.invitations.accept',
    { uuid: invitation.uuid },
    { expiresIn: ACCEPT_LINK_TTL, purpose: INVITATION_SIGNATURE_PURPOSE }
  )
}

/**
 * `${ACCOUNT_INVITE_URL}?link=<signed show path>`. Falls back to the bare
 * signed path when ACCOUNT_INVITE_URL isn't configured (non-production only).
 */
function inviteUrlFor(invitation: Invitation): string {
  const path = signedShowPath(invitation)
  const page = env.get('ACCOUNT_INVITE_URL')
  return page ? `${page}?link=${encodeURIComponent(path)}` : path
}

async function audit(
  invitation: Invitation,
  eventType: 'created' | 'updated',
  userId: number | null,
  action: string,
  trx?: TransactionClientContract
) {
  await AuditEvent.create(
    {
      entityType: 'invitation',
      entityId: invitation.id,
      eventType,
      userId,
      payload: {
        action,
        invitationUuid: invitation.uuid,
        email: invitation.email,
        role: invitation.role,
      },
    },
    trx ? { client: trx } : {}
  )
}

/** Pushes the expiry out and hands back a fresh link - shared by create, resend and a repeated create. */
async function issue(invitation: Invitation): Promise<IssuedInvitation> {
  invitation.merge({
    expiresAt: DateTime.now().plus({ days: INVITATION_TTL_DAYS }),
    lastSentAt: DateTime.now(),
  })
  await invitation.save()

  const inviteUrl = inviteUrlFor(invitation)

  // TODO(mail): email `inviteUrl` to invitation.email (the invite to join
  // MakeXYZ as a <role>). Once this is sent, stop returning inviteUrl from the
  // admin API (admin_invitations_controller.ts) - it's only returned so admins
  // can share the link by hand until mail exists.

  return { invitation, inviteUrl }
}

/**
 * Invites `email` as `role`. A pending invite for the same email and role is
 * re-issued rather than duplicated; an email that already has a user is
 * refused (EmailInUseError) - never converted to the new role.
 */
export async function createInvitation(
  input: { email: string; role: Invitation['role'] },
  invitedBy: User
): Promise<IssuedInvitation & { created: boolean }> {
  const email = normalizeEmail(input.email)
  await assertEmailFree(email)

  const pending = await Invitation.query()
    .where('email', email)
    .where('role', input.role)
    .whereNull('acceptedAt')
    .whereNull('revokedAt')
    .where('expiresAt', '>', DateTime.now().toSQL()!)
    .first()
  if (pending) {
    const issued = await issue(pending)
    await audit(pending, 'updated', invitedBy.id, 'resent')
    return { ...issued, created: false }
  }

  const invitation = await Invitation.create({
    uuid: string.uuid(),
    email,
    role: input.role,
    invitedById: invitedBy.id,
    expiresAt: DateTime.now().plus({ days: INVITATION_TTL_DAYS }),
  })
  await audit(invitation, 'created', invitedBy.id, 'invited')
  return { ...(await issue(invitation)), created: true }
}

/** Re-issues a pending or expired invitation with a fresh expiry and link. */
export async function resendInvitation(
  invitation: Invitation,
  admin: User
): Promise<IssuedInvitation> {
  if (invitation.status === 'accepted' || invitation.status === 'revoked') {
    throw new InvitationNotPendingError(
      `Invitation is already ${invitation.status}`,
      invitation.status
    )
  }
  const issued = await issue(invitation)
  await audit(invitation, 'updated', admin.id, 'resent')
  return issued
}

/** Revokes a pending or expired invitation - every link issued for it stops working. */
export async function revokeInvitation(invitation: Invitation, admin: User): Promise<Invitation> {
  if (invitation.status === 'accepted' || invitation.status === 'revoked') {
    throw new InvitationNotPendingError(
      `Invitation is already ${invitation.status}`,
      invitation.status
    )
  }
  invitation.revokedAt = DateTime.now()
  await invitation.save()
  await audit(invitation, 'updated', admin.id, 'revoked')
  return invitation
}

/** The invitation behind a signed link, if it can still be accepted. */
export async function findPendingInvitation(uuid: string): Promise<Invitation> {
  const invitation = await Invitation.findBy('uuid', uuid)
  if (!invitation) {
    throw new InvitationNotFoundError('Invitation not found')
  }
  if (invitation.status !== 'pending') {
    throw new InvitationNotPendingError(`Invitation is ${invitation.status}`, invitation.status)
  }
  return invitation
}

/**
 * Creates the invitee's user - with the email and role from the invitation,
 * never from the request - plus their Vendor record for a vendor invite, and
 * marks the invitation accepted, all in one transaction. The row lock makes a
 * double-submit accept exactly once.
 */
export async function acceptInvitation(
  uuid: string,
  input: { password: string; fullName?: string | null }
): Promise<{ user: User; vendor: Vendor | null }> {
  const result = await db.transaction(async (trx) => {
    const invitation = await Invitation.query({ client: trx })
      .where('uuid', uuid)
      .forUpdate()
      .first()
    if (!invitation) {
      throw new InvitationNotFoundError('Invitation not found')
    }
    if (invitation.status !== 'pending') {
      throw new InvitationNotPendingError(`Invitation is ${invitation.status}`, invitation.status)
    }

    // Re-checked here, not just at invite time - someone may have signed up
    // with this email since.
    await assertEmailFree(invitation.email, trx)

    const user = await User.create(
      {
        uuid: string.uuid(),
        email: invitation.email,
        role: invitation.role,
        password: input.password,
        fullName: input.fullName ?? null,
      },
      { client: trx }
    )

    const vendor =
      invitation.role === 'vendor'
        ? await Vendor.create(
            { uuid: string.uuid(), userId: user.id, status: 'onboarding' },
            { client: trx }
          )
        : null

    invitation.merge({ acceptedAt: DateTime.now(), acceptedUserId: user.id })
    await invitation.useTransaction(trx).save()
    await audit(invitation, 'updated', user.id, 'accepted', trx)

    return { user, vendor }
  })

  // TODO(mail): welcome email to the new user - for a vendor, what the
  // onboarding checklist involves; optionally also let the inviting admin
  // know the invitation was accepted.

  return result
}
