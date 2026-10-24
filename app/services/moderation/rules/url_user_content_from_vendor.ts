import { effectiveList, urlEvidence } from '#services/moderation/rules/url_shared'
import type { ModerationRule } from '#services/moderation/types'

/**
 * A vendor sending a customer a file-sharing link (Drive, Dropbox...). A
 * customer sharing their CAD that way is normal; the other direction is the
 * classic "view the drawing" phishing lure, and vendors can attach files
 * (which are scanned) instead. Escalates for a closer look.
 */
const urlUserContentFromVendor: ModerationRule = {
  id: 'url.user_content_from_vendor',
  version: 1,
  description: 'Vendor-to-customer file-sharing links, escalated',
  defaultMode: 'enforce',
  defaultConfig: {},
  senderRoles: ['vendor'],
  evaluate(ctx) {
    const shared = ctx.signals.urls.filter((url) => effectiveList(url) === 'user_content')
    if (shared.length === 0) {
      return null
    }
    return {
      action: 'escalate',
      reasonCode: 'url.user_content_from_vendor',
      evidence: urlEvidence(shared),
    }
  },
}

export default urlUserContentFromVendor
