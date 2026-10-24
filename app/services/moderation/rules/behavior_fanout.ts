import type { ModerationRule } from '#services/moderation/types'

type FanoutConfig = {
  vendorsWeight: number
  vendorsEscalate: number
}

/**
 * A customer contacting a great many vendors in a week. Comparison shopping
 * touches a handful; dozens is a scraper or someone pitching vendors. Only
 * customers - vendors can't start conversations, so their reach is bounded
 * by who wrote to them.
 */
const behaviorFanout: ModerationRule<FanoutConfig> = {
  id: 'behavior.fanout',
  version: 1,
  description: 'Customers contacting many vendors in a week (weight, then escalate)',
  defaultMode: 'enforce',
  defaultConfig: { vendorsWeight: 12, vendorsEscalate: 25 },
  senderRoles: ['customer'],
  evaluate(ctx, config) {
    const vendors = ctx.history.vendorsContactedWeek
    const evidence = [
      { view: 'normalized' as const, match: `${vendors} vendors contacted in the last 7 days` },
    ]
    if (vendors >= config.vendorsEscalate) {
      return { action: 'escalate', reasonCode: 'behavior.fanout', evidence }
    }
    if (vendors >= config.vendorsWeight) {
      return { action: 'continue', reasonCode: 'behavior.fanout_wide', weight: 2, evidence }
    }
    return null
  },
}

export default behaviorFanout
