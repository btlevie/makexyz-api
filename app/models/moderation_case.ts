import { ModerationCaseSchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Customer from '#models/customer'
import Message from '#models/message'
import Vendor from '#models/vendor'

/** An item in the human review queue - see moderation_case_service.ts. */
export default class ModerationCase extends ModerationCaseSchema {
  /** Postgres returns a real boolean, SQLite (tests) 0/1 - same as Customer. */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare missedByAutomation: boolean

  /** Postgres returns a parsed object for JSON columns, SQLite (tests) a string - same as ModerationEvaluation. */
  @column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? value : JSON.stringify(value),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
  })
  declare details: Record<string, unknown> | null

  @belongsTo(() => Message)
  declare message: BelongsTo<typeof Message>

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>
}
