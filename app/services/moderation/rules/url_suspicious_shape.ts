import { urlEvidence } from '#services/moderation/rules/url_shared'
import type { ModerationRule } from '#services/moderation/types'
import type { UrlFlag } from '#services/moderation/url/static_checks'

type SuspiciousShapeConfig = {
  highAbuseTldWeight: number
  deepSubdomainWeight: number
  nonStandardPortWeight: number
  idnWeight: number
}

/**
 * Weak link signals that only add risk-score weight: a high-abuse TLD, a
 * very deep subdomain, an unusual port, a non-Latin host. Each is common
 * enough among legitimate sites that none decides anything on its own.
 */
const urlSuspiciousShape: ModerationRule<SuspiciousShapeConfig> = {
  id: 'url.suspicious_shape',
  version: 1,
  description:
    'Weak link signals (abused TLDs, deep subdomains, odd ports, IDN hosts) - weight only',
  defaultMode: 'enforce',
  defaultConfig: {
    highAbuseTldWeight: 2,
    deepSubdomainWeight: 2,
    nonStandardPortWeight: 2,
    idnWeight: 1,
  },
  evaluate(ctx, config) {
    const weights: Partial<Record<UrlFlag, number>> = {
      high_abuse_tld: config.highAbuseTldWeight,
      deep_subdomain: config.deepSubdomainWeight,
      non_standard_port: config.nonStandardPortWeight,
      idn: config.idnWeight,
    }
    const scored = ctx.signals.urls
      .filter((url) => !url.allowlisted)
      .map((url) => ({
        url,
        weight: url.flags.reduce((sum, flag) => sum + (weights[flag] ?? 0), 0),
      }))
      .filter(({ weight }) => weight > 0)
    if (scored.length === 0) {
      return null
    }
    return {
      action: 'continue',
      reasonCode: 'url.suspicious_shape',
      weight: scored.reduce((sum, { weight }) => sum + weight, 0),
      evidence: urlEvidence(scored.map(({ url }) => url)),
    }
  },
}

export default urlSuspiciousShape
