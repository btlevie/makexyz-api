import type { ModerationRule } from '#services/moderation/types'

type VelocityConfig = {
  hourReview: number
  dayReview: number
  hourWeight: number
}

/**
 * Message volume well beyond what a person running jobs sends. The hard cap
 * is the per-minute limiter (messagingThrottle); this catches sustained
 * volume under it: weight at `hourWeight`/hour, a person looks past
 * `hourReview`/hour or `dayReview`/day.
 */
const behaviorVelocity: ModerationRule<VelocityConfig> = {
  id: 'behavior.velocity',
  version: 1,
  description: 'Sustained message volume per sender (weight, then review)',
  defaultMode: 'enforce',
  defaultConfig: { hourReview: 60, dayReview: 300, hourWeight: 30 },
  evaluate(ctx, config) {
    const { messagesLastHour, messagesLastDay } = ctx.history
    const evidence = [
      {
        view: 'normalized' as const,
        match: `${messagesLastHour} messages in the last hour, ${messagesLastDay} in the last day`,
      },
    ]
    if (messagesLastHour >= config.hourReview || messagesLastDay >= config.dayReview) {
      return { action: 'review', reasonCode: 'behavior.velocity', evidence }
    }
    if (messagesLastHour >= config.hourWeight) {
      return { action: 'continue', reasonCode: 'behavior.velocity_high', weight: 2, evidence }
    }
    return null
  },
}

export default behaviorVelocity
