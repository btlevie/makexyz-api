import { urlEvidence } from '#services/moderation/rules/url_shared'
import type { ModerationRule } from '#services/moderation/types'

/**
 * Holds a message with a link that isn't allow-listed and hasn't been
 * analysed yet (no fresh url_scans row). AnalyzeMessage then checks Web
 * Risk, follows redirects and looks up the domain's age, and the message is
 * judged again with the results - usually within seconds. Each URL is
 * analysed once per cache lifetime, however many messages contain it.
 */
const urlUnverified: ModerationRule = {
  id: 'url.unverified',
  version: 1,
  description: 'Links outside the allow list, held until their reputation is checked',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const pending = ctx.signals.urls.filter((url) => !url.allowlisted && url.scan === null)
    if (pending.length === 0) {
      return null
    }
    return { action: 'hold', reasonCode: 'url.unverified', evidence: urlEvidence(pending) }
  },
}

export default urlUnverified
