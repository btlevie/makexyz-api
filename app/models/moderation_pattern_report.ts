import { ModerationPatternReportSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'
import type { PatternCluster, ClusterSummary } from '#services/abuse_pattern_service'

/** Postgres returns a parsed object for JSON columns, SQLite (tests) a string - same as ModerationEvaluation. */
const jsonColumn = {
  prepare: (value: unknown) =>
    value === null || value === undefined ? value : JSON.stringify(value),
  consume: (value: unknown) =>
    typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
}

/** One weekly DiscoverAbusePatterns run - see abuse_pattern_service.ts. */
export default class ModerationPatternReport extends ModerationPatternReportSchema {
  @column(jsonColumn)
  declare clusters: PatternCluster[] | null

  @column(jsonColumn)
  declare summaries: ClusterSummary[] | null
}
