import { effectiveList, urlEvidence } from '#services/moderation/rules/url_shared'
import type { ModerationRule } from '#services/moderation/types'

/**
 * Newly registered domains (RDAP age) - most phishing domains are days old.
 * Under `reviewDays` a person looks first; under `blockDays` it's blocked
 * outright when the sender is a vendor (the riskiest direction) or a new
 * account. Allow-listed and user-content domains are established services.
 */
const urlYoungDomain: ModerationRule<{ reviewDays: number; blockDays: number }> = {
  id: 'url.young_domain',
  version: 1,
  description: 'Links to recently registered domains (review under 30 days, block under 7)',
  defaultMode: 'enforce',
  defaultConfig: { reviewDays: 30, blockDays: 7 },
  evaluate(ctx, config) {
    const young = ctx.signals.urls.filter((url) => {
      const age = url.scan?.domainAgeDays ?? null
      return (
        age !== null &&
        age < config.reviewDays &&
        effectiveList(url) !== 'allow' &&
        effectiveList(url) !== 'user_content'
      )
    })
    if (young.length === 0) {
      return null
    }
    const veryYoung = young.some((url) => url.scan!.domainAgeDays! < config.blockDays)
    if (veryYoung && (ctx.senderRole === 'vendor' || ctx.trustTier === 'new')) {
      return { action: 'block', reasonCode: 'url.very_young_domain', evidence: urlEvidence(young) }
    }
    return { action: 'review', reasonCode: 'url.young_domain', evidence: urlEvidence(young) }
  },
}

export default urlYoungDomain
