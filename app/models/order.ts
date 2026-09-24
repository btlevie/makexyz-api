import { OrderSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Address from '#models/address'
import Customer from '#models/customer'
import OrderItem from '#models/order_item'
import Project from '#models/project'
import Quote from '#models/quote'
import Shipment from '#models/shipment'
import Vendor from '#models/vendor'

export default class Order extends OrderSchema {
  @belongsTo(() => Quote)
  declare quote: BelongsTo<typeof Quote>

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @belongsTo(() => Project)
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>

  @hasMany(() => OrderItem)
  declare items: HasMany<typeof OrderItem>

  @belongsTo(() => Address)
  declare address: BelongsTo<typeof Address>

  @hasMany(() => Shipment)
  declare shipments: HasMany<typeof Shipment>
}
