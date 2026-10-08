import type { HttpContext } from '@adonisjs/core/http'
import Message from '#models/message'
import { reportMessageValidator } from '#validators/messaging'
import { resolveConversation } from '#services/conversation_access_service'
import { reportMessage, ReportNotAllowedError } from '#services/message_report_service'

/**
 * A participant reporting a message they received (contact sharing, payment
 * requests, spam, scams, harassment, prohibited items). Opens or joins a
 * moderation case - see message_report_service.ts.
 */
export default class MessageReportsController {
  async store(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const access = await resolveConversation(ctx, params.uuid)
    if (!access || !access.participant) {
      return response.notFound({ error: 'Conversation not found' })
    }
    const { reason, note } = await request.validateUsing(reportMessageValidator)

    const message = await Message.query()
      .where('uuid', params.messageUuid)
      .where('conversationId', access.conversation.id)
      .first()
    if (!message) {
      return response.notFound({ error: 'Message not found' })
    }

    try {
      const { report, created } = await reportMessage({
        message,
        reporter: access.participant,
        reason,
        note,
      })
      response.status(created ? 201 : 200)
      return await serialize({
        uuid: report.uuid,
        reason: report.reason,
        createdAt: report.createdAt,
      })
    } catch (error) {
      if (error instanceof ReportNotAllowedError) {
        return response.unprocessableEntity({ error: error.message })
      }
      throw error
    }
  }
}
