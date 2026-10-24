import { urlEvidence } from '#services/moderation/rules/url_shared'
import type { ModerationRule } from '#services/moderation/types'

/**
 * A domain outside the allow list that many different senders linked to in
 * the last day - a coordinated campaign across accounts. Allow-listed and
 * file-hosting domains are shared widely for good reasons and don't count.
 */
const urlDomainSpread: ModerationRule<{ otherSenders: number }> = {
  id: 'url.domain_spread',
  version: 1,
  description: 'Unlisted domains linked by many different senders in a day',
  defaultMode: 'shadow',
  defaultConfig: { otherSenders: 4 },
  evaluate(ctx, config) {
    const spread = ctx.signals.urls.filter(
      (url) =>
        url.list === 'none' &&
        url.registrableDomain !== null &&
        (ctx.history.domainSenders[url.registrableDomain] ?? 0) >= config.otherSenders
    )
    if (spread.length === 0) {
      return null
    }
    return {
      action: 'escalate',
      reasonCode: 'url.domain_spread',
      evidence: [
        ...urlEvidence(spread),
        ...spread.map((url) => ({
          view: 'normalized' as const,
          match: `${ctx.history.domainSenders[url.registrableDomain!]} other senders linked ${url.registrableDomain} today`,
        })),
      ],
    }
  },
}

export default urlDomainSpread
