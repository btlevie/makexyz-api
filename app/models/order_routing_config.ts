import { OrderRoutingConfigSchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export default class OrderRoutingConfig extends OrderRoutingConfigSchema {
  /**
   * Redeclared to coerce the value on read - Postgres returns a real boolean
   * but SQLite (tests) returns 0/1, same as PricingConfig.isActive.
   */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare isActive: boolean

  @belongsTo(() => User, { foreignKey: 'createdById' })
  declare createdBy: BelongsTo<typeof User>
}
