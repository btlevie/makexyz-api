import { OrderStatusHistorySchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Order from '#models/order'
import User from '#models/user'

export default class OrderStatusHistory extends OrderStatusHistorySchema {
  @belongsTo(() => Order)
  declare order: BelongsTo<typeof Order>

  @belongsTo(() => User, { foreignKey: 'changedById' })
  declare changedBy: BelongsTo<typeof User>
}
