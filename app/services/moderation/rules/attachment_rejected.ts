import type { ModerationRule } from '#services/moderation/types'

/**
 * An attachment failed its checks (malware, a file that isn't what its name
 * says, a PDF with scripts or embedded files). The whole message is blocked:
 * its text usually refers to the file ("see the drawing attached").
 */
const attachmentRejected: ModerationRule = {
  id: 'attachment.rejected',
  version: 1,
  description: 'Attachments that failed malware/content checks block the message',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const rejected = ctx.signals.attachments.filter((file) => file.status === 'rejected')
    if (rejected.length === 0) {
      return null
    }
    return {
      action: 'block',
      reasonCode: 'attachment.rejected',
      evidence: rejected.map((file) => ({ view: 'raw' as const, match: file.fileName })),
      userMessage:
        "One of the attached files didn't pass our security checks, so this message wasn't sent.",
    }
  },
}

export default attachmentRejected
