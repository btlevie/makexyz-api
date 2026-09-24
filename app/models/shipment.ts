import { ShipmentSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Address from '#models/address'
import Order from '#models/order'
import ShippingLabel from '#models/shipping_label'
import Vendor from '#models/vendor'

export default class Shipment extends ShipmentSchema {
  @belongsTo(() => Order)
  declare order: BelongsTo<typeof Order>

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>

  /** Ship-to address. The origin is always MakeXYZ's (see config/shipping.ts). */
  @belongsTo(() => Address)
  declare address: BelongsTo<typeof Address>

  @hasMany(() => ShippingLabel)
  declare labels: HasMany<typeof ShippingLabel>
}
