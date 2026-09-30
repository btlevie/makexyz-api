import type { HttpContext } from '@adonisjs/core/http'
import Message, { RECIPIENT_VISIBLE_STATUSES } from '#models/message'
import ConversationParticipant from '#models/conversation_participant'
import type Conversation from '#models/conversation'
import ConversationTransformer from '#transformers/conversation_transformer'
import MessageTransformer from '#transformers/message_transformer'
import {
  listMessagesValidator,
  markReadValidator,
  sendMessageValidator,
} from '#validators/messaging'
import {
  listConversationsFor,
  resolveConversation,
  resolveViewer,
} from '#services/conversation_access_service'
import { assertCanPost, ConversationClosedError } from '#services/conversation_service'
import { MessagingSuspendedError, submitMessage } from '#services/message_service'

const DEFAULT_PAGE_SIZE = 50
/** Listing cap - conversations only exist per inquiry/order, so this is generous. */
const MAX_CONVERSATIONS_LISTED = 200

/**
 * Messaging for customers and vendors (see docs/plans/messaging_moderation.md).
 * Access is resolved by conversation_access_service.ts; anything the caller
 * isn't a participant in is a 404. Admins read through the admin endpoints.
 */
export default class ConversationsController {
  async index(ctx: HttpContext) {
    const { response, serialize } = ctx
    const viewer = await resolveViewer(ctx)
    if (!viewer || viewer.kind === 'admin') {
      return response.forbidden({ error: 'Messaging is not available for this account' })
    }

    const all = await listConversationsFor(viewer)
    const conversations = all.slice(0, MAX_CONVERSATIONS_LISTED)
    for (const conversation of conversations) {
      await conversation.load('participants')
      const mine = conversation.participants.find((participant) =>
        viewer.kind === 'customer'
          ? participant.role === 'customer' && participant.customerId === viewer.customer.id
          : participant.role === 'vendor' && participant.vendorId === viewer.vendor.id
      )
      if (mine) {
        await this.attachViewerState(conversation, mine)
      }
    }

    return await serialize(ConversationTransformer.transform(conversations))
  }

  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const access = await resolveConversation(ctx, params.uuid)
    if (!access || !access.participant) {
      return response.notFound({ error: 'Conversation not found' })
    }

    await access.conversation.load('participants')
    await this.attachViewerState(access.conversation, access.participant)
    return await serialize(ConversationTransformer.transform(access.conversation))
  }

  /** Messages after `afterSeq`, oldest first - poll or page forward with the last seq seen. */
  async messages(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const access = await resolveConversation(ctx, params.uuid)
    if (!access || !access.participant) {
      return response.notFound({ error: 'Conversation not found' })
    }
    const { afterSeq, limit } = await request.validateUsing(listMessagesValidator)
    const participant = access.participant

    const messages = await Message.query()
      .where('conversationId', access.conversation.id)
      .where('seq', '>', afterSeq ?? 0)
      // Others only ever see delivered messages (or a removal tombstone); the
      // sender also sees their own held and blocked ones.
      .where((query) =>
        query
          .whereIn('status', RECIPIENT_VISIBLE_STATUSES)
          .orWhere('senderParticipantId', participant.id)
      )
      .orderBy('seq', 'asc')
      .limit(limit ?? DEFAULT_PAGE_SIZE)
      .preload('sender')

    for (const message of messages) {
      message.$extras.mine = message.senderParticipantId === participant.id
    }
    return await serialize(MessageTransformer.transform(messages))
  }

  /**
   * Sends a message. It's moderated before anyone else can see it - the
   * response says whether it was delivered, is under review, or was blocked
   * (and why). 201 for a new message, 200 when the same clientMessageId was
   * already sent (a retry).
   */
  async storeMessage(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const access = await resolveConversation(ctx, params.uuid)
    if (!access || !access.participant) {
      return response.notFound({ error: 'Conversation not found' })
    }
    const { body, clientMessageId } = await request.validateUsing(sendMessageValidator)

    try {
      const { message, created } = await submitMessage({
        conversation: access.conversation,
        participant: access.participant,
        body,
        clientMessageId,
      })
      await message.load('sender')
      message.$extras.mine = true
      response.status(created ? 201 : 200)
      return await serialize(MessageTransformer.transform(message))
    } catch (error) {
      if (error instanceof ConversationClosedError) {
        return response.conflict({ error: error.message })
      }
      if (error instanceof MessagingSuspendedError) {
        return response.forbidden({ error: error.message })
      }
      throw error
    }
  }

  /** Marks everything up to `seq` as read for the caller. Never moves backwards. */
  async markRead(ctx: HttpContext) {
    const { params, request, response } = ctx
    const access = await resolveConversation(ctx, params.uuid)
    if (!access || !access.participant) {
      return response.notFound({ error: 'Conversation not found' })
    }
    const { seq } = await request.validateUsing(markReadValidator)
    const target = Math.min(seq, access.conversation.lastSeq)

    await ConversationParticipant.query()
      .where('id', access.participant.id)
      .where('lastReadSeq', '<', target)
      .update({ last_read_seq: target })

    return response.noContent()
  }

  /** Per-viewer fields the transformer reads from $extras. */
  private async attachViewerState(
    conversation: Conversation,
    participant: ConversationParticipant
  ) {
    const unread = await Message.query()
      .where('conversationId', conversation.id)
      .where('seq', '>', participant.lastReadSeq)
      .whereIn('status', ['delivered', 'delivered_flagged'])
      .where((query) =>
        query.whereNull('senderParticipantId').orWhereNot('senderParticipantId', participant.id)
      )
      .count('* as total')
      .first()

    let canPost = true
    try {
      await assertCanPost(conversation, participant)
    } catch (error) {
      if (!(error instanceof ConversationClosedError)) throw error
      canPost = false
    }

    conversation.$extras.lastReadSeq = participant.lastReadSeq
    conversation.$extras.unreadCount = Number(unread?.$extras.total ?? 0)
    conversation.$extras.canPost = canPost
  }
}
