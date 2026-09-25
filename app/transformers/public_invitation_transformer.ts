import { BaseTransformer } from '@adonisjs/core/transformers'
import type Invitation from '#models/invitation'

/**
 * What the invitee's page sees: enough to prefill (and lock) the form, plus
 * the signed URL to POST the password to. Nothing about who invited them.
 */
export default class PublicInvitationTransformer extends BaseTransformer<Invitation> {
  constructor(
    invitation: Invitation,
    private acceptUrl: string
  ) {
    super(invitation)
  }

  toObject() {
    return {
      invitation: {
        uuid: this.resource.uuid,
        email: this.resource.email,
        role: this.resource.role,
        expiresAt: this.resource.expiresAt,
      },
      acceptUrl: this.acceptUrl,
    }
  }
}
