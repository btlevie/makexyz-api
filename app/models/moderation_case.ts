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

  @belongsTo(() => Message)
  declare message: BelongsTo<typeof Message>

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>
}
