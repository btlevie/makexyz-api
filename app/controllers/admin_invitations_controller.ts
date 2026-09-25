import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Invitation from '#models/invitation'
import InvitationTransformer from '#transformers/invitation_transformer'
import { createInvitationValidator, INVITATION_STATUSES } from '#validators/invitation'
import { isAdmin } from '#services/project_grant_service'
import {
  createInvitation,
  EmailInUseError,
  InvitationNotPendingError,
  resendInvitation,
  revokeInvitation,
} from '#services/invitation_service'

/**
 * Admin side of invitations - see invitation_service.ts and
 * docs/VENDOR_ONBOARDING.md. Same manual isAdmin() check as the other admin
 * controllers (no policy/ability convention exists yet, see CLAUDE.md).
 */
export default class AdminInvitationsController {
  /**
   * Invites an email as a role. `inviteUrl` is returned only so admins can
   * share it by hand until mail exists - see the TODO(mail) in
   * invitation_service.ts#issue.
   */
  async store(ctx: HttpContext) {
    const { request, response, serialize, auth } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const input = await request.validateUsing(createInvitationValidator)

    try {
      const { invitation, inviteUrl } = await createInvitation(input, auth.getUserOrFail())
      return await serialize({ invitation: InvitationTransformer.transform(invitation), inviteUrl })
    } catch (error) {
      if (error instanceof EmailInUseError) {
        return response.conflict({
          error: error.message,
          existingRole: error.existingRole,
          vendorUuid: error.vendorUuid,
        })
      }
      throw error
    }
  }

  async index(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const status = request.input('status')
    if (status !== undefined && !INVITATION_STATUSES.includes(status)) {
      return response.unprocessableEntity({
        error: `status must be one of ${INVITATION_STATUSES.join(', ')}`,
      })
    }

    // Status is derived (see Invitation#status), so filter on the columns it's
    // derived from.
    const now = DateTime.now().toSQL()!
    const query = Invitation.query().orderBy('createdAt', 'desc')
    if (status === 'accepted') {
      query.whereNotNull('acceptedAt')
    } else if (status === 'revoked') {
      query.whereNull('acceptedAt').whereNotNull('revokedAt')
    } else if (status === 'expired') {
      query.whereNull('acceptedAt').whereNull('revokedAt').where('expiresAt', '<=', now)
    } else if (status === 'pending') {
      query.whereNull('acceptedAt').whereNull('revokedAt').where('expiresAt', '>', now)
    }

    return await serialize(InvitationTransformer.transform(await query))
  }

  async resend(ctx: HttpContext) {
    const { params, response, serialize, auth } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const invitation = await Invitation.findBy('uuid', params.uuid)
    if (!invitation) {
      return response.notFound({ error: 'Invitation not found' })
    }

    try {
      const issued = await resendInvitation(invitation, auth.getUserOrFail())
      return await serialize({
        invitation: InvitationTransformer.transform(issued.invitation),
        inviteUrl: issued.inviteUrl,
      })
    } catch (error) {
      if (error instanceof InvitationNotPendingError) {
        return response.conflict({ error: error.message, reason: error.status })
      }
      throw error
    }
  }

  async revoke(ctx: HttpContext) {
    const { params, response, serialize, auth } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const invitation = await Invitation.findBy('uuid', params.uuid)
    if (!invitation) {
      return response.notFound({ error: 'Invitation not found' })
    }

    try {
      await revokeInvitation(invitation, auth.getUserOrFail())
      return await serialize(InvitationTransformer.transform(invitation))
    } catch (error) {
      if (error instanceof InvitationNotPendingError) {
        return response.conflict({ error: error.message, reason: error.status })
      }
      throw error
    }
  }
}
