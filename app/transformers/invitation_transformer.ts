import { BaseTransformer } from '@adonisjs/core/transformers'
import type Invitation from '#models/invitation'

/** The admin view of an invitation - see public_invitation_transformer.ts for what the invitee sees. */
export default class InvitationTransformer extends BaseTransformer<Invitation> {
  async toObject() {
    const invitation = this.resource
    await invitation.load('invitedBy')
    return {
      uuid: invitation.uuid,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      lastSentAt: invitation.lastSentAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
      createdAt: invitation.createdAt,
      invitedBy: invitation.invitedBy
        ? {
            uuid: invitation.invitedBy.uuid,
            fullName: invitation.invitedBy.fullName,
            email: invitation.invitedBy.email,
          }
        : null,
    }
  }
}
