import { MessageSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'

/** Statuses the recipient can see (removed shows as a tombstone). */
export const RECIPIENT_VISIBLE_STATUSES: Message['status'][] = [
  'delivered',
  'delivered_flagged',
  'removed',
]

/** Statuses that count as the message having reached the other side. */
export const DELIVERED_STATUSES: Message['status'][] = ['delivered', 'delivered_flagged']

export default class Message extends MessageSchema {
  @belongsTo(() => Conversation)
  declare conversation: BelongsTo<typeof Conversation>

  @belongsTo(() => ConversationParticipant, { foreignKey: 'senderParticipantId' })
  declare sender: BelongsTo<typeof ConversationParticipant>
}
