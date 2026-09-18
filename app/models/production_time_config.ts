import { ProductionTimeConfigSchema } from '#database/schema'
import { belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import ProductionTimeTier from '#models/production_time_tier'
import User from '#models/user'

/**
 * Versioned, technology-agnostic production-time configuration - unlike
 * PricingConfig, there's no per-technology values table since production time
 * is priced the same way regardless of FDM/SLA/SLS.
 */
export default class ProductionTimeConfig extends ProductionTimeConfigSchema {
  /**
   * Redeclared to coerce the value on read - Postgres returns a real boolean
   * but SQLite (tests) returns 0/1, same as PricingConfig.isActive.
   */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare isActive: boolean

  @hasMany(() => ProductionTimeTier)
  declare tiers: HasMany<typeof ProductionTimeTier>

  @belongsTo(() => User, { foreignKey: 'createdById' })
  declare createdBy: BelongsTo<typeof User>
}
