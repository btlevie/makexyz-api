import type { ModerationRule } from '#services/moderation/types'

/**
 * Any profanity. A small weight only, never a block: a frustrated customer
 * swearing about a snapped bracket is still a customer. The risks this
 * platform cares about are scams, off-platform deals, ads and unsafe links.
 */
const profanityGeneral: ModerationRule<{ weight: number }> = {
  id: 'profanity.general',
  version: 1,
  description: 'Profanity (small weight only - never blocks)',
  defaultMode: 'shadow',
  defaultConfig: { weight: 1 },
  evaluate(ctx, config) {
    const { profanity } = ctx.signals
    return profanity.count > 0
      ? {
          action: 'continue',
          reasonCode: 'profanity.general',
          weight: config.weight,
          evidence: profanity.terms.map((term) => ({ view: 'normalized' as const, match: term })),
        }
      : null
  },
}

export default profanityGeneral
