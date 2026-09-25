import type { HttpContext } from '@adonisjs/core/http'
import PublicInvitationTransformer from '#transformers/public_invitation_transformer'
import UserTransformer from '#transformers/user_transformer'
import { acceptInvitationValidator } from '#validators/invitation'
import {
  acceptInvitation,
  EmailInUseError,
  findPendingInvitation,
  INVITATION_SIGNATURE_PURPOSE,
  InvitationNotFoundError,
  InvitationNotPendingError,
  signedAcceptPath,
} from '#services/invitation_service'

/**
 * The invitee's side of an invitation - public, authorized by the signed URL
 * the admin shared (see invitation_service.ts and docs/VENDOR_ONBOARDING.md).
 */
export default class InvitationsController {
  /** Prefills the invite page: email (read-only), role, and the signed URL to accept at. */
  async show({ request, params, response, serialize }: HttpContext) {
    if (!request.hasValidSignature(INVITATION_SIGNATURE_PURPOSE)) {
      return response.forbidden({ error: 'This invitation link is invalid or has expired' })
    }

    try {
      const invitation = await findPendingInvitation(params.uuid)
      return await serialize(
        PublicInvitationTransformer.transform(invitation, signedAcceptPath(invitation))
      )
    } catch (error) {
      return this.handleError(error, response)
    }
  }

  /**
   * Creates the account (email and role from the invitation, never the
   * request) and logs the new user in on the web guard, same as
   * AccessTokensController#store.
   */
  async accept({ request, params, response, serialize, auth }: HttpContext) {
    if (!request.hasValidSignature(INVITATION_SIGNATURE_PURPOSE)) {
      return response.forbidden({ error: 'This invitation link is invalid or has expired' })
    }

    const { fullName, password } = await request.validateUsing(acceptInvitationValidator)

    try {
      const { user } = await acceptInvitation(params.uuid, { fullName, password })
      await auth.use('web').login(user)
      return await serialize({ user: UserTransformer.transform(user) })
    } catch (error) {
      return this.handleError(error, response)
    }
  }

  private handleError(error: unknown, response: HttpContext['response']) {
    if (error instanceof InvitationNotFoundError) {
      return response.notFound({ error: error.message })
    }
    if (error instanceof InvitationNotPendingError) {
      return response.gone({ error: error.message, reason: error.status })
    }
    if (error instanceof EmailInUseError) {
      return response.conflict({ error: 'An account with this email already exists' })
    }
    throw error
  }
}
