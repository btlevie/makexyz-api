/**
 * Replays moderation over stored messages (docs/plans/messaging_moderation.md,
 * section 6 step 6). Rules are pure functions of what the pipeline stored -
 * the message text, the evaluation's signals and its context snapshot - so a
 * candidate rule can be run over past traffic and measured before it
 * enforces anything:
 *
 * - recall: of the messages a moderator confirmed as violations, how many
 *   the rule would have caught;
 * - estimated false positives: of the messages known to be fine (approved by
 *   a moderator, or delivered with no case), how many it would have hit.
 *
 * Replaying the whole rule set over a message with unchanged rules and
 * configs reproduces the decision it got at the time.
 */
import { DateTime } from 'luxon'
import Message from '#models/message'
import ModerationCase from '#models/moderation_case'
import ModerationEvaluation from '#models/moderation_evaluation'
import { buildViews } from '#services/moderation/normalizer'
import { evaluateRules } from '#services/moderation/pipeline'
import { getActiveRules, type ResolvedRule } from '#services/moderation/rule_registry'
import type { RuleContext } from '#services/moderation/types'

export type ReplayLabel = 'violation' | 'clean' | 'unlabelled'

export interface ReplayOptions {
  /** Only this rule (a candidate, typically still in shadow); all rules when omitted. */
  ruleId?: string
  /** Config overrides for that rule, e.g. a tighter threshold to try. */
  config?: Record<string, unknown>
  since: DateTime
  limit?: number
  /** How many examples of each kind of outcome to return. */
  examples?: number
}

export interface ReplayRow {
  messageUuid: string
  label: ReplayLabel
  /** Whether the replayed rule(s) fired, and what they asked for. */
  fired: boolean
  action: string | null
  decision: string
  /** The decision stored at the time. */
  originalDecision: string
}

export interface ReplayReport {
  ruleId: string | null
  evaluated: number
  fired: number
  violations: number
  violationsCaught: number
  clean: number
  cleanHit: number
  /** Share of confirmed violations the rule catches. */
  recall: number | null
  /** Share of known-clean messages it would hit. */
  falsePositiveRate: number | null
  /** Replayed whole-pipeline decisions that differ from the stored one (all-rules replay). */
  changedDecisions: number
  examples: { caught: ReplayRow[]; missed: ReplayRow[]; falsePositives: ReplayRow[] }
}

const DEFAULT_LIMIT = 5000

/**
 * A message's label from human decisions: a moderator blocked or removed it
 * (or labelled it with a category) - a violation; approved it, or it was
 * delivered and nobody ever opened a case - clean; anything else (an
 * automatic block nobody reviewed) is unlabelled.
 */
export function labelOf(message: Message, cases: ModerationCase[]): ReplayLabel {
  const resolved = cases.filter((moderationCase) => moderationCase.status === 'resolved')
  if (
    resolved.some(
      (moderationCase) =>
        moderationCase.resolution === 'blocked' ||
        moderationCase.resolution === 'removed' ||
        (Boolean(moderationCase.abuseCategory) && moderationCase.abuseCategory !== 'none')
    )
  ) {
    return 'violation'
  }
  if (resolved.some((moderationCase) => moderationCase.resolution === 'approved')) {
    return 'clean'
  }
  if (
    cases.length === 0 &&
    (message.status === 'delivered' || message.status === 'delivered_flagged')
  ) {
    return 'clean'
  }
  return 'unlabelled'
}

/** The rule context a stored evaluation saw, rebuilt from what was stored. */
export function replayContext(
  message: Message,
  evaluation: ModerationEvaluation
): RuleContext | null {
  const stored = evaluation.context
  const signals = evaluation.signals
  if (!stored || !signals) return null
  const fileNames = (signals.attachments ?? []).map((file) => file.fileName)
  return {
    views: buildViews([message.body, ...fileNames, ...(stored.attachmentText ?? [])].join('\n')),
    signals,
    senderRole: stored.senderRole,
    channel: stored.channel,
    conversation: stored.conversation,
    history: stored.history,
    trustTier: stored.trustTier,
  }
}

function rulesFor(active: ResolvedRule[], options: ReplayOptions): ResolvedRule[] {
  if (!options.ruleId) return active
  const rule = active.find((resolved) => resolved.rule.id === options.ruleId)
  if (!rule) {
    throw new Error(`Unknown rule ${options.ruleId}`)
  }
  // Measured as if enforcing - the point is to see what it would do.
  return [{ ...rule, mode: 'enforce', config: { ...rule.config, ...(options.config ?? {}) } }]
}

export async function replay(options: ReplayOptions): Promise<ReplayReport> {
  const rules = rulesFor(await getActiveRules(), options)
  const evaluations = await ModerationEvaluation.query()
    .where('stage', 'sync')
    .whereNotNull('context')
    .whereNotNull('messageId')
    .where('createdAt', '>', options.since.toSQL()!)
    .orderBy('id', 'asc')
    .limit(options.limit ?? DEFAULT_LIMIT)
  const messages = await Message.query().whereIn(
    'id',
    evaluations.map((evaluation) => evaluation.messageId!)
  )
  const cases = await ModerationCase.query().whereIn(
    'messageId',
    messages.map((message) => message.id)
  )

  const rows: ReplayRow[] = []
  for (const evaluation of evaluations) {
    const message = messages.find((row) => row.id === evaluation.messageId)
    if (!message) continue
    const context = replayContext(message, evaluation)
    if (!context) continue
    const outcome = evaluateRules(context, rules)
    const hit = outcome.hits[0] ?? null
    rows.push({
      messageUuid: message.uuid,
      label: labelOf(
        message,
        cases.filter((moderationCase) => moderationCase.messageId === message.id)
      ),
      fired: options.ruleId ? hit !== null : outcome.decision !== 'allow',
      action: options.ruleId ? (hit?.action ?? null) : outcome.decision,
      decision: outcome.decision,
      originalDecision: evaluation.decision,
    })
  }

  const take = options.examples ?? 10
  const violations = rows.filter((row) => row.label === 'violation')
  const clean = rows.filter((row) => row.label === 'clean')
  const caught = violations.filter((row) => row.fired)
  const cleanHit = clean.filter((row) => row.fired)
  return {
    ruleId: options.ruleId ?? null,
    evaluated: rows.length,
    fired: rows.filter((row) => row.fired).length,
    violations: violations.length,
    violationsCaught: caught.length,
    clean: clean.length,
    cleanHit: cleanHit.length,
    recall: violations.length > 0 ? caught.length / violations.length : null,
    falsePositiveRate: clean.length > 0 ? cleanHit.length / clean.length : null,
    changedDecisions: options.ruleId
      ? 0
      : rows.filter((row) => row.decision !== row.originalDecision).length,
    examples: {
      caught: caught.slice(0, take),
      missed: violations.filter((row) => !row.fired).slice(0, take),
      falsePositives: cleanHit.slice(0, take),
    },
  }
}

/** "90d", "24h", "2w" -> a start time. */
export function sinceFrom(window: string, now: DateTime = DateTime.now()): DateTime {
  const match = window.trim().match(/^(\d+)\s*([hdw])$/i)
  if (!match) {
    throw new Error(`Use a window like 90d, 24h or 2w (got "${window}")`)
  }
  const amount = Number(match[1])
  const unit = { h: 'hours', d: 'days', w: 'weeks' }[match[2].toLowerCase() as 'h' | 'd' | 'w']
  return now.minus({ [unit]: amount })
}
