import type { ModerationRule } from '#services/moderation/types'

/**
 * Attachments that couldn't be checked automatically - the malware scanner
 * is off or gave no result in time, or a PDF couldn't be parsed. A person
 * looks before the recipient can download them.
 */
const attachmentUnverified: ModerationRule = {
  id: 'attachment.unverified',
  version: 1,
  description: 'Attachments the scanner could not check, held for review',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const unchecked = ctx.signals.attachments.filter((file) => file.status === 'review')
    if (unchecked.length === 0) {
      return null
    }
    return {
      action: 'review',
      reasonCode: 'attachment.unverified',
      evidence: unchecked.map((file) => ({ view: 'raw' as const, match: file.fileName })),
    }
  },
}

export default attachmentUnverified
