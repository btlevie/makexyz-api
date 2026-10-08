import { promoEvidence } from '#services/moderation/rules/ad_promo_language'
import type { ModerationRule } from '#services/moderation/types'

/**
 * A vendor sending a customer a link outside the allowlist. In a white-label
 * order thread there's rarely a legitimate reason; in an inquiry it might be
 * a datasheet. Escalates; with promotional language it's advertising and
 * blocks (generic reason - spam rules don't explain themselves).
 */
const adUnrelatedUrl: ModerationRule = {
  id: 'ad.unrelated_url',
  version: 1,
  description: 'Vendor-to-customer links outside the allowlist (blocks with promo language)',
  defaultMode: 'shadow',
  defaultConfig: {},
  senderRoles: ['vendor'],
  evaluate(ctx) {
    const unknown = ctx.signals.urls.filter((url) => !url.allowlisted)
    if (unknown.length === 0) {
      return null
    }
    const evidence = unknown.map((url) => ({ view: 'deobfuscated' as const, match: url.match }))
    const promo = promoEvidence(ctx)
    if (promo.length > 0) {
      return {
        action: 'block',
        reasonCode: 'ad.unrelated_url_promo',
        evidence: [...evidence, ...promo],
      }
    }
    return { action: 'escalate', reasonCode: 'ad.unrelated_url', evidence }
  },
}

export default adUnrelatedUrl
