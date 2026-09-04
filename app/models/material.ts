import { MaterialSchema } from '#database/schema'
import { column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import MaterialColor from '#models/material_color'

export default class Material extends MaterialSchema {
  /**
   * Redeclared to coerce the value on read. Postgres returns a real boolean but
   * SQLite (tests) returns 0/1, and the generated schema types this as boolean -
   * without this, tests would exercise different semantics than production.
   */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare isDefault: boolean

  @hasMany(() => MaterialColor)
  declare colors: HasMany<typeof MaterialColor>
}
