import type { ModerationRule } from '#services/moderation/types'

/**
 * Holds a message whose attachments are still being scanned. The scan job
 * (ScanAttachment) re-runs the message's analysis once it finishes.
 */
const attachmentPending: ModerationRule = {
  id: 'attachment.pending',
  version: 1,
  description: 'Attachments still being scanned - the message waits',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const pending = ctx.signals.attachments.filter(
      (file) => file.status === 'uploaded' || file.status === 'pending_upload'
    )
    if (pending.length === 0) {
      return null
    }
    return {
      action: 'hold',
      reasonCode: 'attachment.pending',
      evidence: pending.map((file) => ({ view: 'raw' as const, match: file.fileName })),
    }
  },
}

export default attachmentPending
