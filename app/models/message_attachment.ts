import { MessageAttachmentSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

/** Postgres returns a parsed object for JSON columns, SQLite (tests) a string - same as ModerationEvaluation. */
const jsonColumn = {
  prepare: (value: unknown) =>
    value === null || value === undefined ? value : JSON.stringify(value),
  consume: (value: unknown) =>
    typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
}

/**
 * A file sent in a conversation. Uploaded straight to a quarantine prefix,
 * scanned, then promoted - see attachment_service.ts.
 */
export default class MessageAttachment extends MessageAttachmentSchema {
  @column(jsonColumn)
  declare scanDetails: Record<string, unknown> | null
}
