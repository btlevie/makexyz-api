import type { ModerationRule } from '#services/moderation/types'

/**
 * Sending again soon after being blocked - often rephrasing the same contact
 * details or link to find what gets through. Weight only: an honest sender
 * correcting themselves is common, so this just makes the next message
 * easier to flag. Past the hold threshold the sender is held outright
 * (messaging_risk_service.ts#noteBlockedAttempt).
 */
const behaviorRepeatAttempts: ModerationRule<{ weightPerBlock: number; maxWeight: number }> = {
  id: 'behavior.repeat_attempts',
  version: 1,
  description: 'Messages sent soon after blocked ones (weight per recent block)',
  defaultMode: 'enforce',
  defaultConfig: { weightPerBlock: 1, maxWeight: 4 },
  evaluate(ctx, config) {
    const blocked = ctx.history.blockedLastHour
    if (blocked === 0) {
      return null
    }
    return {
      action: 'continue',
      reasonCode: 'behavior.repeat_attempts',
      weight: Math.min(blocked * config.weightPerBlock, config.maxWeight),
      evidence: [{ view: 'normalized', match: `${blocked} blocked message(s) in the last hour` }],
    }
  },
}

export default behaviorRepeatAttempts
