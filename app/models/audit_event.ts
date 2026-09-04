import { AuditEventSchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export default class AuditEvent extends AuditEventSchema {
  /**
   * Redeclared to serialize the JSON column in both directions. Postgres returns
   * a parsed object while SQLite (tests) returns a string, so normalize here
   * rather than leaving callers to guess which they got.
   */
  @column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? value : JSON.stringify(value),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
  })
  declare payload: any | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
