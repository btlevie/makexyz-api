import { PaymentSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import CheckoutSession from '#models/checkout_session'
import Refund from '#models/refund'

export default class Payment extends PaymentSchema {
  @belongsTo(() => CheckoutSession)
  declare checkoutSession: BelongsTo<typeof CheckoutSession>

  @hasMany(() => Refund)
  declare refunds: HasMany<typeof Refund>
}
