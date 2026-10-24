import { effectiveList, urlEvidence } from '#services/moderation/rules/url_shared'
import type { ModerationRule } from '#services/moderation/types'
import type { UrlFlag } from '#services/moderation/url/static_checks'

const UNSAFE_FLAGS: UrlFlag[] = ['private_ip', 'userinfo', 'bad_scheme', 'lookalike']

/**
 * Links that are malicious on their face or by reputation: a private or
 * metadata IP, credentials in the URL, a non-web scheme, a look-alike of a
 * brand or allow-listed domain, a moderator-blocked domain, or a Web Risk
 * threat / redirect into a private network found by the async analysis.
 * Blocks with the generic reason - naming the check helps people probe it.
 */
const urlUnsafe: ModerationRule = {
  id: 'url.unsafe',
  version: 1,
  description:
    'Malicious links: private IPs, look-alike domains, blocked domains, Web Risk threats',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const unsafe = ctx.signals.urls.filter(
      (url) =>
        url.flags.some((flag) => UNSAFE_FLAGS.includes(flag)) ||
        url.list === 'block' ||
        effectiveList(url) === 'block' ||
        url.scan?.verdict === 'malicious'
    )
    if (unsafe.length === 0) {
      return null
    }
    return { action: 'block', reasonCode: 'url.unsafe', evidence: urlEvidence(unsafe) }
  },
}

export default urlUnsafe
