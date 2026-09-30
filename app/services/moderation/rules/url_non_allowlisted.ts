import type { ModerationRule } from '#services/moderation/types'

/**
 * Holds any message linking outside the allowlist until a person has looked
 * at it. The safety floor until URL reputation exists (Web Risk, redirect
 * resolution, domain age - docs/plans/messaging_moderation.md Step 3), at
 * which point unknown links go to automated analysis instead and only the
 * doubtful ones reach a human.
 */
const urlNonAllowlisted: ModerationRule = {
  id: 'url.any_non_allowlisted_holds',
  version: 1,
  description: 'Links to domains outside the allowlist, held for review',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const unknown = ctx.signals.urls.filter((url) => !url.allowlisted)
    if (unknown.length === 0) {
      return null
    }
    return {
      action: 'review',
      reasonCode: 'url.unverified',
      evidence: unknown.map((url) => ({ view: 'deobfuscated' as const, match: url.match })),
    }
  },
}

export default urlNonAllowlisted
