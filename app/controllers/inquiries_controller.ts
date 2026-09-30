import string from '@adonisjs/core/helpers/string'
import type { HttpContext } from '@adonisjs/core/http'
import ConversationParticipant from '#models/conversation_participant'
import Customer from '#models/customer'
import Vendor from '#models/vendor'
import ConversationTransformer from '#transformers/conversation_transformer'
import MessageTransformer from '#transformers/message_transformer'
import { createInquiryValidator } from '#validators/messaging'
import { createInquiry, InquiryNotAllowedError } from '#services/conversation_service'
import { MessagingSuspendedError, submitMessage } from '#services/message_service'

/**
 * A customer starting a conversation with a vendor - the only way a
 * conversation begins without an order. Needs a customer account with a
 * verified email; vendors can never start one. See
 * conversation_service.ts#createInquiry for every other condition.
 */
export default class InquiriesController {
  async store(ctx: HttpContext) {
    const { auth, params, request, response, serialize } = ctx
    const user = auth.getUserOrFail()
    const { subject, body, clientMessageId } = await request.validateUsing(createInquiryValidator)

    const vendor = await Vendor.findBy('uuid', params.vendorUuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }

    // Accounts made through /auth/signup don't get a Customer row until they
    // need one - same lazy creation as guest claims.
    const customer =
      user.role === 'customer'
        ? await Customer.firstOrCreate(
            { userId: user.id },
            { userId: user.id, uuid: string.uuid() }
          )
        : null

    let conversation
    try {
      if (!customer) {
        throw new InquiryNotAllowedError(
          'not_a_customer',
          'Only customer accounts can message vendors'
        )
      }
      conversation = await createInquiry({ user, customer, vendor, subject })
    } catch (error) {
      if (!(error instanceof InquiryNotAllowedError)) throw error
      switch (error.code) {
        case 'email_unverified':
        case 'not_a_customer':
          return response.forbidden({ error: error.message, code: error.code })
        case 'already_open':
          return response.conflict({
            error: error.message,
            code: error.code,
            conversationUuid: error.existingConversationUuid,
          })
        case 'daily_cap_reached':
          return response.tooManyRequests({ error: error.message, code: error.code })
        default:
          // 'blocked' deliberately reads exactly like an unavailable vendor.
          return response.unprocessableEntity({ error: error.message, code: 'vendor_unavailable' })
      }
    }

    const participant = await ConversationParticipant.query()
      .where('conversationId', conversation.id)
      .where('role', 'customer')
      .firstOrFail()

    try {
      const { message } = await submitMessage({ conversation, participant, body, clientMessageId })
      await message.load('sender')
      message.$extras.mine = true
      await conversation.load('participants')

      response.status(201)
      return await serialize({
        conversation: await ConversationTransformer.transform(conversation),
        message: await MessageTransformer.transform(message),
      })
    } catch (error) {
      if (error instanceof MessagingSuspendedError) {
        return response.forbidden({ error: error.message })
      }
      throw error
    }
  }
}
