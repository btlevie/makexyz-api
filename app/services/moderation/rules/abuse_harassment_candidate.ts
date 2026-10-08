import type { ModerationRule } from '#services/moderation/types'

/**
 * Profanity aimed at the reader ("you f***ing idiot") rather than at a
 * failed print. Escalates - harassment is never auto-blocked; a person
 * decides.
 */
const abuseHarassmentCandidate: ModerationRule = {
  id: 'abuse.harassment_candidate',
  version: 1,
  description: 'Profanity directed at the recipient',
  defaultMode: 'shadow',
  defaultConfig: {},
  evaluate(ctx) {
    const { profanity } = ctx.signals
    return profanity.directed
      ? {
          action: 'escalate',
          reasonCode: 'abuse.harassment_candidate',
          evidence: profanity.terms.map((term) => ({ view: 'normalized' as const, match: term })),
        }
      : null
  },
}

export default abuseHarassmentCandidate
