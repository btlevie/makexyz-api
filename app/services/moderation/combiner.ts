/**
 * Turns the rules that fired into one decision.
 *
 * Explicit decisions come from rules; the risk score only routes. Precedence
 * is block > review > escalate > flag > allow. Weak signals (`continue`)
 * never block on their own - their summed weight can only raise a message to
 * flag/escalate/review. Shadow hits are recorded but never counted.
 */
import type { Decision, RuleAction, RuleResult } from '#services/moderation/types'

/** Score thresholds - per trust tier once tiers exist (Step 4). */
export const SCORE_THRESHOLDS = { flag: 3, escalate: 6, review: 10 }

const DECISION_RANK: Record<Decision, number> = {
  allow: 0,
  flag: 1,
  escalate: 2,
  review: 3,
  block: 4,
}

const ACTION_DECISION: Partial<Record<RuleAction, Decision>> = {
  block: 'block',
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

function scoreDecision(riskScore: number): Decision {
  if (riskScore >= SCORE_THRESHOLDS.review) return 'review'
  if (riskScore >= SCORE_THRESHOLDS.escalate) return 'escalate'
  if (riskScore >= SCORE_THRESHOLDS.flag) return 'flag'
  return 'allow'
}

export function combine(fired: FiredRule[]): Combined {
  const enforced = fired.filter((hit) => !hit.shadow)
  const riskScore = enforced.reduce((sum, hit) => sum + (hit.result.weight ?? 0), 0)

  let decision: Decision = scoreDecision(riskScore)
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
