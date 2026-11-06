import { SearchEventSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

/** Postgres returns a parsed object for JSON columns, SQLite (tests) a string - same as ModerationEvaluation. */
const jsonColumn = {
  prepare: (value: unknown) =>
    value === null || value === undefined ? value : JSON.stringify(value),
  consume: (value: unknown) =>
    typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
}

/** One directory search - see search_analytics_service.ts. */
export default class SearchEvent extends SearchEventSchema {
  @column(jsonColumn)
  declare filters: Record<string, unknown> | null
}
