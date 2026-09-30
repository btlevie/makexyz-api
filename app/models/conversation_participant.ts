import { ConversationParticipantSchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Conversation from '#models/conversation'
import Customer from '#models/customer'
import User from '#models/user'
import Vendor from '#models/vendor'

export default class ConversationParticipant extends ConversationParticipantSchema {
  /** Postgres returns a real boolean, SQLite (tests) 0/1 - same as Customer. */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare emailNotifications: boolean

  @belongsTo(() => Conversation)
  declare conversation: BelongsTo<typeof Conversation>

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
