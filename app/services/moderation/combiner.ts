/**
 * Turns the rules that fired into one decision.
 *
 * Explicit decisions come from rules; the risk score only routes. Precedence
 * is block > hold > review > escalate > flag > allow. Hold outranks review:
 * a message waiting on link or attachment analysis is judged again once that
 * finishes, so a person reviewing it later sees the results. Weak signals
 * (`continue`) never block on their own - their summed weight can only raise
 * a message to flag/escalate/review. Shadow hits are recorded but never
 * counted.
 */
import type { Decision, RuleAction, RuleResult } from '#services/moderation/types'
import type { TrustTier } from '#services/messaging_risk_service'

/**
 * Risk-score thresholds per sender trust tier: new accounts reach flag and
 * review sooner. (Restricted and suspended senders are held regardless, in
 * message_service.ts.)
 */
export const SCORE_THRESHOLDS: Record<
  TrustTier,
  { flag: number; escalate: number; review: number }
> = {
  new: { flag: 2, escalate: 4, review: 8 },
  standard: { flag: 3, escalate: 6, review: 10 },
  trusted: { flag: 4, escalate: 8, review: 12 },
  restricted: { flag: 2, escalate: 4, review: 8 },
  suspended: { flag: 2, escalate: 4, review: 8 },
}

const DECISION_RANK: Record<Decision, number> = {
  allow: 0,
  flag: 1,
  escalate: 2,
  review: 3,
  hold: 4,
  block: 5,
}

const ACTION_DECISION: Partial<Record<RuleAction, Decision>> = {
  block: 'block',
  hold: 'hold',
  review: 'review',
  escalate: 'escalate',
  flag: 'flag',
}

export interface FiredRule {
  ruleId: string
  result: RuleResult
  shadow: boolean
}

export interface Combined {
  decision: Decision
  riskScore: number
  /** The enforced hit that set the decision, if one did. */
  decidedBy: FiredRule | null
}

function scoreDecision(riskScore: number, tier: TrustTier): Decision {
  const thresholds = SCORE_THRESHOLDS[tier]
  if (riskScore >= thresholds.review) return 'review'
  if (riskScore >= thresholds.escalate) return 'escalate'
  if (riskScore >= thresholds.flag) return 'flag'
  return 'allow'
}

export function combine(fired: FiredRule[], tier: TrustTier = 'standard'): Combined {
  const enforced = fired.filter((hit) => !hit.shadow)
  const riskScore = enforced.reduce((sum, hit) => sum + (hit.result.weight ?? 0), 0)

  let decision: Decision = scoreDecision(riskScore, tier)
  let decidedBy: FiredRule | null = null

  for (const hit of enforced) {
    const candidate = ACTION_DECISION[hit.result.action]
    if (candidate && DECISION_RANK[candidate] > DECISION_RANK[decision]) {
      decision = candidate
      decidedBy = hit
    } else if (candidate && candidate === decision && !decidedBy) {
      decidedBy = hit
    }
  }

  return { decision, riskScore, decidedBy }
}
