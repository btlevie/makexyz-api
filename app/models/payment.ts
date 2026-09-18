import { PaymentSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import CheckoutSession from '#models/checkout_session'

export default class Payment extends PaymentSchema {
  @belongsTo(() => CheckoutSession)
  declare checkoutSession: BelongsTo<typeof CheckoutSession>
}
