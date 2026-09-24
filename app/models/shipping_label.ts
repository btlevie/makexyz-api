import { ShippingLabelSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Shipment from '#models/shipment'

export default class ShippingLabel extends ShippingLabelSchema {
  @belongsTo(() => Shipment)
  declare shipment: BelongsTo<typeof Shipment>
}
