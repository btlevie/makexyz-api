import string from '@adonisjs/core/helpers/string'
import type { HttpContext } from '@adonisjs/core/http'
import Customer from '#models/customer'
import { GuestClaimNotAllowedError, mergeGuestCustomer } from '#services/customer_claim_service'
import { GUEST_CLAIM_SIGNATURE_PURPOSE, sendGuestClaimEmail } from '#services/guest_claim_service'
import { normalizeEmail } from '#services/invitation_service'

/**
 * Linking a signed-in customer's earlier guest quotes/orders to their account,
 * via a signed link emailed to the guest's address (see guest_claim_service.ts
 * and customer_claim_service.ts).
 */
export default class GuestClaimsController {
  /**
   * (Re)sends the claim link for the signed-in customer's email. Always 202 -
   * the response never reveals whether that email has guest history.
   */
  async store({ auth, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.role === 'customer') {
      await sendGuestClaimEmail(user)
    }

    response.status(202)
    return await serialize({
      message: 'If there are earlier quotes or orders under your email, a link has been sent to it',
    })
  }

  /**
   * Merges the guest customer into the signed-in account. Requires both the
   * signed link (proves the email) and being signed in as the user it was
   * issued to - so a link opened in someone else's browser can't move a
   * victim's orders into an attacker's account.
   */
  async confirm({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!request.hasValidSignature(GUEST_CLAIM_SIGNATURE_PURPOSE)) {
      return response.forbidden({ error: 'This link is invalid or has expired' })
    }
    if (params.userUuid !== user.uuid || user.role !== 'customer') {
      return response.forbidden({ error: 'This link belongs to a different account' })
    }

    const guest = await Customer.findBy('uuid', params.customerUuid)
    if (!guest || guest.userId) {
      return response.notFound({ error: 'Nothing left to link - it may already be linked' })
    }
    if (guest.email !== normalizeEmail(user.email)) {
      return response.forbidden({ error: 'This link belongs to a different account' })
    }

    const customer = await Customer.firstOrCreate(
      { userId: user.id },
      { userId: user.id, uuid: string.uuid() }
    )

    try {
      const result = await mergeGuestCustomer(guest, customer)
      return await serialize(result)
    } catch (error) {
      if (error instanceof GuestClaimNotAllowedError) {
        return response.notFound({ error: 'Nothing left to link - it may already be linked' })
      }
      throw error
    }
  }
}
