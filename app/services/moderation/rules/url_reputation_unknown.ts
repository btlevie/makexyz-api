import { effectiveList, urlEvidence } from '#services/moderation/rules/url_shared'
import type { ModerationRule } from '#services/moderation/types'

/**
 * The analysis ran but couldn't get a reputation (Web Risk not configured or
 * failing). Rather than deliver an unknown link, a person looks at it.
 */
const urlReputationUnknown: ModerationRule = {
  id: 'url.reputation_unknown',
  version: 1,
  description: 'Links whose reputation could not be checked, held for review',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const unknown = ctx.signals.urls.filter(
      (url) => url.scan?.verdict === 'unknown' && effectiveList(url) !== 'allow'
    )
    if (unknown.length === 0) {
      return null
    }
    return {
      action: 'review',
      reasonCode: 'url.reputation_unknown',
      evidence: urlEvidence(unknown),
    }
  },
}

export default urlReputationUnknown
