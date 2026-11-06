import { VendorIndicativePriceSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Material from '#models/material'
import Vendor from '#models/vendor'

/** A vendor's published (non-binding) price per cm3 for a material. */
export default class VendorIndicativePrice extends VendorIndicativePriceSchema {
  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>

  @belongsTo(() => Material)
  declare material: BelongsTo<typeof Material>
}
