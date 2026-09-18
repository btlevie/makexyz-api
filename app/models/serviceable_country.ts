import { ServiceableCountrySchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

export default class ServiceableCountry extends ServiceableCountrySchema {
  /**
   * Redeclared to coerce the value on read - Postgres returns a real boolean
   * but SQLite (tests) returns 0/1, same as PricingConfig.isActive.
   */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare isActive: boolean
}
