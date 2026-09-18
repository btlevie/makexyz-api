import { VendorTechnologyCapabilitySchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Vendor from '#models/vendor'

export default class VendorTechnologyCapability extends VendorTechnologyCapabilitySchema {
  /**
   * Redeclared to coerce the value on read - Postgres returns a real boolean
   * but SQLite (tests) returns 0/1, same as PricingConfig.isActive.
   */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare isPreferred: boolean

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>
}
