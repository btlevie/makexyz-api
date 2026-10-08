import { MessageReportSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Message from '#models/message'

/** A participant reporting a message they received. Feeds a moderation case. */
export default class MessageReport extends MessageReportSchema {
  @belongsTo(() => Message)
  declare message: BelongsTo<typeof Message>
}
