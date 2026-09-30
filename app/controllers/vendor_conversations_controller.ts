import type { HttpContext } from '@adonisjs/core/http'
import { closeConversationValidator } from '#validators/messaging'
import { resolveConversation } from '#services/conversation_access_service'
import {
  blockInquiryCustomer,
  ConversationClosedError,
  declineInquiry,
} from '#services/conversation_service'

/**
 * A vendor's controls over inquiries sent to them: pass on one, or block the
 * customer from sending more (which also alerts staff). See
 * conversation_service.ts.
 */
export default class VendorConversationsController {
  async decline(ctx: HttpContext) {
    const { params, request, response } = ctx
    const access = await resolveConversation(ctx, params.uuid)
    if (!access || access.viewer.kind !== 'vendor') {
      return response.notFound({ error: 'Conversation not found' })
    }
    const { reason } = await request.validateUsing(closeConversationValidator)

    try {
      await declineInquiry(access.conversation, reason)
    } catch (error) {
      if (error instanceof ConversationClosedError) {
        return response.conflict({ error: error.message })
      }
      throw error
    }
    return response.noContent()
  }

  async blockCustomer(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const access = await resolveConversation(ctx, params.uuid)
    if (!access || access.viewer.kind !== 'vendor') {
      return response.notFound({ error: 'Conversation not found' })
    }
    const { reason } = await request.validateUsing(closeConversationValidator)

    try {
      await blockInquiryCustomer(access.conversation, auth.getUserOrFail(), reason)
    } catch (error) {
      if (error instanceof ConversationClosedError) {
        return response.conflict({ error: error.message })
      }
      throw error
    }
    return response.noContent()
  }
}
