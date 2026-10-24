import { UrlScanSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

/** Postgres returns a parsed object for JSON columns, SQLite (tests) a string - same as ModerationEvaluation. */
const jsonColumn = {
  prepare: (value: unknown) =>
    value === null || value === undefined ? value : JSON.stringify(value),
  consume: (value: unknown) =>
    typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
}

/** The cached reputation of one normalized URL (see url_analysis_service.ts). */
export default class UrlScan extends UrlScanSchema {
  /** Web Risk threat types, e.g. SOCIAL_ENGINEERING. */
  @column(jsonColumn)
  declare threatTypes: string[] | null

  /** Every URL visited while following redirects, starting with the original. */
  @column(jsonColumn)
  declare redirectChain: string[] | null

  @column(jsonColumn)
  declare details: Record<string, unknown> | null
}
