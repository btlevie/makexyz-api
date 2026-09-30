import type { HttpContext } from '@adonisjs/core/http'
import UserTransformer from '#transformers/user_transformer'
import {
  EMAIL_VERIFICATION_SIGNATURE_PURPOSE,
  emailFingerprint,
  isEmailVerified,
  markEmailVerified,
  sendVerificationEmail,
} from '#services/email_verification_service'

/**
 * Proving the signed-in account owns its email address (see
 * email_verification_service.ts).
 */
export default class EmailVerificationsController {
  /** (Re)sends the verification link. 202 either way; a no-op once verified. */
  async store({ auth, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!isEmailVerified(user)) {
      await sendVerificationEmail(user)
    }

    response.status(202)
    return await serialize({
      message: 'If your email still needs confirming, a link has been sent to it',
    })
  }

  /**
   * Marks the email verified. Requires both the signed link (proves the
   * mailbox) and being signed in as the user it was issued to, for the same
   * reason as guest claims: a link opened in someone else's session must not
   * verify their account.
   */
  async confirm({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!request.hasValidSignature(EMAIL_VERIFICATION_SIGNATURE_PURPOSE)) {
      return response.forbidden({ error: 'This link is invalid or has expired' })
    }
    if (params.userUuid !== user.uuid || params.emailHash !== emailFingerprint(user.email)) {
      return response.forbidden({ error: 'This link belongs to a different account' })
    }

    await markEmailVerified(user)
    return await serialize(UserTransformer.transform(user))
  }
}
