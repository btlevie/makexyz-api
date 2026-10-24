import { urlEvidence } from '#services/moderation/rules/url_shared'
import type { ModerationRule } from '#services/moderation/types'

/**
 * Links straight to programs/installers, or to archives, on domains that
 * aren't allow-listed. Files should be attached instead, where they're
 * scanned - and the reason says so, since a legitimate sender just needs to
 * know what to do instead.
 */
const urlDangerousFile: ModerationRule = {
  id: 'url.dangerous_file',
  version: 1,
  description: 'Links to executables or archives outside the allow list',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const files = ctx.signals.urls.filter(
      (url) =>
        !url.allowlisted &&
        (url.flags.includes('dangerous_extension') || url.flags.includes('archive_extension'))
    )
    if (files.length === 0) {
      return null
    }
    return {
      action: 'block',
      reasonCode: 'url.dangerous_file',
      evidence: urlEvidence(files),
      userMessage:
        "Links to programs or archives can't be sent here. Attach the file to your message instead, so it can be checked.",
    }
  },
}

export default urlDangerousFile
