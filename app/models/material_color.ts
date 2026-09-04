import { MaterialColorSchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Material from '#models/material'

export default class MaterialColor extends MaterialColorSchema {
  /**
   * Redeclared to coerce the value on read. Postgres returns a real boolean but
   * SQLite (tests) returns 0/1, and the generated schema types this as boolean -
   * without this, tests would exercise different semantics than production.
   */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare isDefault: boolean

  @belongsTo(() => Material)
  declare material: BelongsTo<typeof Material>
}
