import { urlEvidence } from '#services/moderation/rules/url_shared'
import type { ModerationRule } from '#services/moderation/types'

/**
 * A link to a bare public IP address - legitimate businesses use names.
 * (Private and metadata IPs are blocked by url.unsafe.)
 */
const urlIpLiteral: ModerationRule = {
  id: 'url.ip_literal',
  version: 1,
  description: 'Links to a bare public IP address, held for review',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const ips = ctx.signals.urls.filter(
      (url) => url.flags.includes('ip_literal') && !url.flags.includes('private_ip')
    )
    if (ips.length === 0) {
      return null
    }
    return { action: 'review', reasonCode: 'url.ip_literal', evidence: urlEvidence(ips) }
  },
}

export default urlIpLiteral
