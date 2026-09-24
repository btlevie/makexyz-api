import { VendorPayoutRateSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Material from '#models/material'
import Vendor from '#models/vendor'

export default class VendorPayoutRate extends VendorPayoutRateSchema {
  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>

  @belongsTo(() => Material)
  declare material: BelongsTo<typeof Material>
}
