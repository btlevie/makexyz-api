import { PricingConfigSchema } from '#database/schema'
import { belongsTo, column, hasOne } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasOne } from '@adonisjs/lucid/types/relations'
import FdmPricingConfigValue from '#models/fdm_pricing_config_value'
import User from '#models/user'

/**
 * Versioned, technology-scoped pricing configuration header. The constants
 * themselves live in a per-technology values table (fdmValues below) so that
 * adding a technology means adding a table, not widening this one with columns
 * that are nullable for every other technology.
 */
export default class PricingConfig extends PricingConfigSchema {
  /**
   * Redeclared to coerce the value on read. Postgres returns a real boolean but
   * SQLite (tests) returns 0/1, and the generated schema types this as boolean -
   * without this, tests would exercise different semantics than production.
   */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare isActive: boolean

  @hasOne(() => FdmPricingConfigValue)
  declare fdmValues: HasOne<typeof FdmPricingConfigValue>

  @belongsTo(() => User, { foreignKey: 'createdById' })
  declare createdBy: BelongsTo<typeof User>
}
