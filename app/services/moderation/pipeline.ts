/**
 * The synchronous moderation pass, run before a message is stored or
 * delivered: normalize -> extract -> rules -> combine. Pure CPU plus one
 * cached config read, so it stays in the request path (see
 * docs/plans/messaging_moderation.md, "Process placement").
 *
 * It decides; it doesn't persist. message_service.ts stores the message, the
 * evaluation and the rule hits in one transaction with the outcome.
 */
import { buildViews } from '#services/moderation/normalizer'
import { extractSignals } from '#services/moderation/extractors'
import { combine, type FiredRule } from '#services/moderation/combiner'
import { getActiveRules } from '#services/moderation/rule_registry'
import type {
  Channel,
  ConversationKind,
  Decision,
  Evidence,
  RuleAction,
  SenderRole,
  Signals,
  TextViews,
} from '#services/moderation/types'

/** Bumped when the normalizer or extractors change, so old evaluations stay explainable. */
export const PIPELINE_VERSION = '1'

export interface ModerationInput {
  text: string
  senderRole: SenderRole
  channel: Channel
  conversationKind: ConversationKind
}

export interface HitRecord {
  ruleId: string
  ruleVersion: number
  configVersion: number
  action: RuleAction
  weight: number
  shadow: boolean
  evidence: Evidence[]
}

export interface ModerationOutcome {
  decision: Decision
  riskScore: number
  views: TextViews
  signals: Signals
  rulesEvaluated: string[]
  hits: HitRecord[]
  /** The rule behind the decision, for the message's reason fields. */
  reasonCode: string | null
  userFacingReason: string | null
  durationMs: number
}

export async function moderateMessage(input: ModerationInput): Promise<ModerationOutcome> {
  const startedAt = performance.now()
  const views = buildViews(input.text)
  const signals = extractSignals(views)
  const context = {
    views,
    signals,
    senderRole: input.senderRole,
    channel: input.channel,
    conversationKind: input.conversationKind,
  }

  const activeRules = await getActiveRules()
  const rules = activeRules.filter(({ rule }) =>
    rule.senderRoles ? rule.senderRoles.includes(input.senderRole) : input.senderRole !== 'staff'
  )

  const fired: FiredRule[] = []
  const hits: HitRecord[] = []
  for (const { rule, mode, config, configVersion } of rules) {
    const result = rule.evaluate(context, config)
    if (!result) {
      continue
    }
    const shadow = mode === 'shadow'
    fired.push({ ruleId: rule.id, result, shadow })
    hits.push({
      ruleId: rule.id,
      ruleVersion: rule.version,
      configVersion,
      action: result.action,
      weight: result.weight ?? 0,
      shadow,
      evidence: result.evidence,
    })
  }

  const { decision, riskScore, decidedBy } = combine(fired)

  return {
    decision,
    riskScore,
    views,
    signals,
    rulesEvaluated: rules.map(({ rule }) => `${rule.id}@${rule.version}`),
    hits,
    reasonCode: decidedBy?.result.reasonCode ?? null,
    userFacingReason: decidedBy?.result.userMessage ?? null,
    durationMs: Math.round(performance.now() - startedAt),
  }
}
