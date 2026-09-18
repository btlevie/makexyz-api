import { CheckoutSessionSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Customer from '#models/customer'
import Payment from '#models/payment'
import Project from '#models/project'
import Quote from '#models/quote'

export default class CheckoutSession extends CheckoutSessionSchema {
  @belongsTo(() => Quote)
  declare quote: BelongsTo<typeof Quote>

  @belongsTo(() => Project)
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @hasMany(() => Payment)
  declare payments: HasMany<typeof Payment>
}
