import type { ModerationRule } from '#services/moderation/types'

type ReputationConfig = {
  reportsWeight: number
  reportsHeavy: number
}

/**
 * A sender other people keep reporting, or (customers) that vendors keep
 * blocking, over the last 30 days. Weight only - reports alone aren't proof,
 * but they make the sender's next borderline message reach review sooner.
 */
const behaviorSenderReputation: ModerationRule<ReputationConfig> = {
  id: 'behavior.sender_reputation',
  version: 1,
  description: 'Senders reported or blocked by others recently (weight)',
  defaultMode: 'enforce',
  defaultConfig: { reportsWeight: 2, reportsHeavy: 5 },
  evaluate(ctx, config) {
    const { reportsReceived30d, vendorBlocks30d } = ctx.history
    let weight = 0
    if (reportsReceived30d >= config.reportsHeavy) weight += 4
    else if (reportsReceived30d >= config.reportsWeight) weight += 2
    if (vendorBlocks30d >= 1) weight += 2
    if (weight === 0) {
      return null
    }
    return {
      action: 'continue',
      reasonCode: 'behavior.sender_reputation',
      weight,
      evidence: [
        {
          view: 'normalized',
          match: `${reportsReceived30d} report(s) and ${vendorBlocks30d} vendor block(s) in 30 days`,
        },
      ],
    }
  },
}

export default behaviorSenderReputation
