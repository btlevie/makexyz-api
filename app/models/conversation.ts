import { ConversationSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import ConversationParticipant from '#models/conversation_participant'
import Customer from '#models/customer'
import Message from '#models/message'
import Order from '#models/order'
import Project from '#models/project'
import Vendor from '#models/vendor'

/**
 * A thread between a customer and a vendor (and MakeXYZ staff), always tied
 * to something - an inquiry, an order, or a support request. There are no
 * free-form DMs. See docs/plans/messaging_moderation.md and
 * conversation_service.ts.
 */
export default class Conversation extends ConversationSchema {
  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>

  @belongsTo(() => Project)
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => Order)
  declare order: BelongsTo<typeof Order>

  @hasMany(() => ConversationParticipant)
  declare participants: HasMany<typeof ConversationParticipant>

  @hasMany(() => Message)
  declare messages: HasMany<typeof Message>
}
