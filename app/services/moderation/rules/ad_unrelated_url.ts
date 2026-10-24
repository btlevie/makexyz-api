import { promoEvidence } from '#services/moderation/rules/ad_promo_language'
import { urlEvidence } from '#services/moderation/rules/url_shared'
import type { ExtractedUrl, ModerationRule } from '#services/moderation/types'

/**
 * Profile-shaped paths ("/@acme", "/user/acme", "/social/...") on model
 * repositories - allow-listed, but a vendor's own profile is a way to take a
 * customer off-platform.
 */
const PROFILE_PATH = /^\/(?:@[^/]+|users?\/|social\/|profile|members?\/|designers?\/|makers?\/)/

function isProfileLink(url: ExtractedUrl): boolean {
  if (!url.allowlisted) return false
  try {
    return PROFILE_PATH.test(new URL(url.url).pathname)
  } catch {
    return false
  }
}

/**
 * A vendor sending a customer a link outside the allow list, or to a profile
 * page on an allow-listed site. In a white-label order thread there's rarely
 * a legitimate reason; in an inquiry it might be a datasheet. Escalates; with
 * promotional language it's advertising and blocks (generic reason - spam
 * rules don't explain themselves).
 */
const adUnrelatedUrl: ModerationRule = {
  id: 'ad.unrelated_url',
  version: 2,
  description:
    'Vendor-to-customer links outside the allow list or to profile pages (blocks with promo language)',
  defaultMode: 'shadow',
  defaultConfig: {},
  senderRoles: ['vendor'],
  evaluate(ctx) {
    const unrelated = ctx.signals.urls.filter((url) => !url.allowlisted || isProfileLink(url))
    if (unrelated.length === 0) {
      return null
    }
    const evidence = urlEvidence(unrelated)
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
