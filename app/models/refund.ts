import { RefundSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Payment from '#models/payment'

export default class Refund extends RefundSchema {
  @belongsTo(() => Payment)
  declare payment: BelongsTo<typeof Payment>
}
