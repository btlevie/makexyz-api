import { ModerationRuleHitSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'
import type { Evidence } from '#services/moderation/types'

/** A rule that fired during an evaluation (non-firing rules get no row). */
export default class ModerationRuleHit extends ModerationRuleHitSchema {
  /** Postgres returns a real boolean, SQLite (tests) 0/1 - same as Customer. */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare shadow: boolean

  /** Redeclared to serialize the JSON column in both directions - same as AuditEvent. */
  @column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? value : JSON.stringify(value),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
  })
  declare evidence: Evidence[] | null
}
