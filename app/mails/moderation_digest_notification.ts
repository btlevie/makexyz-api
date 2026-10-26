import { BaseMail } from '@adonisjs/mail'

export interface DigestCounts {
  /** Messages a sender is waiting on (held for a person). */
  waiting: number
  oldestWaitingHours: number | null
  bySource: Record<string, number>
}

/**
 * The daily note to admins when people are waiting on moderation (D8:
 * best-effort review, no set response time - so a nudge rather than a pager).
 * See moderation_digest_service.ts.
 */
export default class ModerationDigestNotification extends BaseMail {
  subject = 'MakeXYZ moderation: messages waiting for review'

  constructor(
    private email: string,
    private counts: DigestCounts,
    private queueUrl: string | null
  ) {
    super()
  }

  prepare() {
    const { waiting, oldestWaitingHours, bySource } = this.counts
    const lines = [
      `${waiting} message(s) are held for review - their senders are waiting.`,
      oldestWaitingHours !== null ? `The oldest has waited ${oldestWaitingHours} hour(s).` : '',
      '',
      'Open cases by source:',
      ...Object.entries(bySource).map(([source, count]) => `- ${source}: ${count}`),
      '',
      this.queueUrl
        ? `Review queue: ${this.queueUrl}`
        : 'Review them in the admin moderation queue.',
    ].filter((line, index, all) => line !== '' || all[index - 1] !== '')
    this.message.to(this.email)
    this.message.text(lines.join('\n'))
  }
}
