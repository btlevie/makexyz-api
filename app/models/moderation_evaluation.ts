import { ModerationEvaluationSchema } from '#database/schema'
import { belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Message from '#models/message'
import ModerationRuleHit from '#models/moderation_rule_hit'
import type { Signals } from '#services/moderation/types'
import type { ReplayContext } from '#services/moderation/pipeline'

/**
 * Postgres returns a parsed object for JSON columns, SQLite (tests) a string -
 * same normalization as AuditEvent, shared by this model's JSON columns.
 */
const jsonColumn = {
  prepare: (value: unknown) =>
    value === null || value === undefined ? value : JSON.stringify(value),
  consume: (value: unknown) =>
    typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
}

/** One moderation pipeline pass over a message - the explainability record. */
export default class ModerationEvaluation extends ModerationEvaluationSchema {
  @column(jsonColumn)
  declare signals: Signals | null

  /** `rule_id@version` for every rule that ran, fired or not. */
  @column(jsonColumn)
  declare rulesEvaluated: string[] | null

  @column(jsonColumn)
  declare llm: Record<string, unknown> | null

  /** The replay snapshot (pipeline.ts ReplayContext) - see moderation_replay_service.ts. */
  @column(jsonColumn)
  declare context: ReplayContext | null

  @belongsTo(() => Message)
  declare message: BelongsTo<typeof Message>

  @hasMany(() => ModerationRuleHit, { foreignKey: 'evaluationId' })
  declare hits: HasMany<typeof ModerationRuleHit>
}
