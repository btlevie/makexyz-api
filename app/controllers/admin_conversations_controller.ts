import type { HttpContext } from '@adonisjs/core/http'
import Conversation from '#models/conversation'
import Message from '#models/message'
import ModerationRuleHit from '#models/moderation_rule_hit'
import AdminMessageTransformer from '#transformers/admin_message_transformer'
import ConversationTransformer from '#transformers/conversation_transformer'
import { adminListConversationsValidator } from '#validators/messaging'
import { isAdmin } from '#services/project_grant_service'

const MAX_LISTED = 200

/**
 * Read-only admin access to every conversation, with every message whatever
 * its status and the rules that fired on it. Admins don't post yet.
 */
export default class AdminConversationsController {
  async index(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { kind, status } = await request.validateUsing(adminListConversationsValidator)

    const conversations = await Conversation.query()
      .if(kind, (query) => query.where('kind', kind!))
      .if(status, (query) => query.where('status', status!))
      .orderByRaw('coalesce(last_message_at, created_at) desc')
      .limit(MAX_LISTED)
      .preload('participants')

    return await serialize(ConversationTransformer.transform(conversations))
  }

  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const conversation = await Conversation.query()
      .where('uuid', params.uuid)
      .preload('participants')
      .first()
    if (!conversation) {
      return response.notFound({ error: 'Conversation not found' })
    }

    const messages = await Message.query()
      .where('conversationId', conversation.id)
      .orderBy('seq', 'asc')
      .preload('sender')
    const hits = await ModerationRuleHit.query().whereIn(
      'messageId',
      messages.map((message) => message.id)
    )
    for (const message of messages) {
      message.$extras.ruleHits = hits
        .filter((hit) => hit.messageId === message.id)
        .map((hit) => ({
          ruleId: hit.ruleId,
          ruleVersion: hit.ruleVersion,
          action: hit.action,
          shadow: hit.shadow,
          evidence: hit.evidence,
        }))
    }

    return await serialize({
      conversation: await ConversationTransformer.transform(conversation),
      messages: await AdminMessageTransformer.transform(messages),
    })
  }
}
