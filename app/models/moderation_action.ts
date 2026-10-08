import { ModerationActionSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

/** One human moderation decision or rule change. Append-only. */
export default class ModerationAction extends ModerationActionSchema {
  /** Redeclared to serialize the JSON column in both directions - same as AuditEvent. */
  @column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? value : JSON.stringify(value),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
  })
  declare metadata: Record<string, unknown> | null
}
