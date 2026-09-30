import { ModerationRuleConfigSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

export default class ModerationRuleConfig extends ModerationRuleConfigSchema {
  /**
   * Redeclared to serialize the JSON column in both directions - Postgres
   * returns a parsed object, SQLite (tests) a string. Same as AuditEvent.
   */
  @column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? value : JSON.stringify(value),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
  })
  declare config: Record<string, unknown> | null
}
