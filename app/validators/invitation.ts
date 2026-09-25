import vine from '@vinejs/vine'
import { email, password } from '#validators/user'

/** Admin: invite an email as a role. Existing-email rules live in invitation_service.ts. */
export const createInvitationValidator = vine.create({
  email: email().trim().toLowerCase(),
  role: vine.enum(['vendor', 'admin'] as const),
})

/** Accepted values for GET /v1/admin/invitations?status= (see Invitation#status). */
export const INVITATION_STATUSES: readonly string[] = ['pending', 'accepted', 'revoked', 'expired']

/**
 * Invitee: accept an invitation. Deliberately no email or role - both come
 * from the invitation row, never from the request.
 */
export const acceptInvitationValidator = vine.create({
  fullName: vine.string().trim().maxLength(255).optional(),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
})
