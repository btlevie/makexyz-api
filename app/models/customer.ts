import { CustomerSchema } from '#database/schema'
import { column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Address from '#models/address'

export default class Customer extends CustomerSchema {
  /**
   * Redeclared to coerce the value on read. Postgres returns a real boolean but
   * SQLite (tests) returns 0/1, and the generated schema types this as boolean -
   * without this, tests would exercise different semantics than production.
   */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare marketingOptIn: boolean

  @hasMany(() => Address)
  declare addresses: HasMany<typeof Address>
}
