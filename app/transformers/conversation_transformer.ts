import { BaseTransformer } from '@adonisjs/core/transformers'
import type Conversation from '#models/conversation'

/**
 * A conversation as a participant (or admin) sees it. Participants appear
 * only by role and display name - never an email, user id or (for an
 * instant-quote order) the vendor's identity.
 *
 * Per-viewer fields ride on $extras, set by ConversationsController:
 * `lastReadSeq`, `unreadCount`, `canPost`.
 */
export default class ConversationTransformer extends BaseTransformer<Conversation> {
  toObject() {
    const conversation = this.resource
    return {
      uuid: conversation.uuid,
      kind: conversation.kind,
      subject: conversation.subject,
      status: conversation.status,
      closedReason: conversation.closedReason,
      lastSeq: conversation.lastSeq,
      lastMessageAt: conversation.lastMessageAt,
      createdAt: conversation.createdAt,
      participants: conversation.participants
        ? conversation.participants.map((participant) => ({
            role: participant.role,
            displayName: participant.displayName,
          }))
        : undefined,
      lastReadSeq: (conversation.$extras.lastReadSeq ?? null) as number | null,
      unreadCount: (conversation.$extras.unreadCount ?? null) as number | null,
      canPost: (conversation.$extras.canPost ?? null) as boolean | null,
    }
  }
}
