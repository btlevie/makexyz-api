/**
 * How well each moderation rule is doing, from moderators' decisions
 * (docs/plans/messaging_moderation.md, section 6 "Labels"): of the messages
 * a rule hit that a person then judged, how many were real violations
 * (precision), and how many of every confirmed violation it caught
 * (recall). An enforcing rule whose hits keep getting overturned is flagged
 * to go back to shadow - flagged, never switched automatically.
 */
import { DateTime } from 'luxon'
import Message from '#models/message'
import ModerationCase from '#models/moderation_case'
import ModerationRuleHit from '#models/moderation_rule_hit'
import { RULES } from '#services/moderation/rules/index'
import { getActiveRules } from '#services/moderation/rule_registry'
import { labelOf } from '#services/moderation_replay_service'

/** Below this precision, with enough judged hits, an enforcing rule is flagged for shadow. */
const SHADOW_PRECISION = 0.7
const MIN_JUDGED = 5

export interface RuleStats {
  ruleId: string
  mode: string
  hits: number
  shadowHits: number
  /** Hits on messages a moderator then judged a violation / fine. */
  confirmed: number
  overturned: number
  precision: number | null
  /** Of all confirmed violations in the window, how many this rule hit. */
  recall: number | null
  suggestShadow: boolean
}

export async function ruleStats(days: number): Promise<RuleStats[]> {
  const since = DateTime.now().minus({ days }).toSQL()!
  const hits = await ModerationRuleHit.query()
    .whereIn('messageId', (query) =>
      query.from('messages').where('created_at', '>', since).select('id')
    )
    .select('ruleId', 'shadow', 'messageId')
  const messages = await Message.query().where('createdAt', '>', since).select('id', 'status')
  const cases = await ModerationCase.query().whereIn(
    'messageId',
    messages.map((message) => message.id)
  )

  const labels = new Map(
    messages.map((message) => [
      message.id,
      labelOf(
        message,
        cases.filter((moderationCase) => moderationCase.messageId === message.id)
      ),
    ])
  )
  const violations = [...labels.values()].filter((label) => label === 'violation').length
  const active = await getActiveRules()
  const modes = new Map(active.map(({ rule, mode }) => [rule.id, mode]))

  return RULES.map((rule) => {
    const own = hits.filter((hit) => hit.ruleId === rule.id)
    const judgedMessages = new Map<number, string>()
    for (const hit of own) {
      const label = labels.get(hit.messageId!)
      if (label && label !== 'unlabelled') judgedMessages.set(hit.messageId!, label)
    }
    const confirmed = [...judgedMessages.values()].filter((label) => label === 'violation').length
    const overturned = [...judgedMessages.values()].filter((label) => label === 'clean').length
    const judged = confirmed + overturned
    const precision = judged > 0 ? confirmed / judged : null
    const mode = modes.get(rule.id) ?? rule.defaultMode
    return {
      ruleId: rule.id,
      mode,
      hits: own.filter((hit) => !hit.shadow).length,
      shadowHits: own.filter((hit) => hit.shadow).length,
      confirmed,
      overturned,
      precision,
      recall: violations > 0 ? confirmed / violations : null,
      suggestShadow:
        mode === 'enforce' &&
        judged >= MIN_JUDGED &&
        precision !== null &&
        precision < SHADOW_PRECISION,
    }
  }).sort((a, b) => b.hits + b.shadowHits - (a.hits + a.shadowHits))
}
