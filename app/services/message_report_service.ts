/**
 * Participants reporting messages they received. A report opens (or joins)
 * a moderation case for the message - several reports on the same message
 * share one open case, which moves up the queue with each serious report.
 */
import string from '@adonisjs/core/helpers/string'
import db from '@adonisjs/lucid/services/db'
import type ConversationParticipant from '#models/conversation_participant'
import type Message from '#models/message'
import { DELIVERED_STATUSES } from '#models/message'
import MessageReport from '#models/message_report'
import ModerationCase from '#models/moderation_case'

/** Queue priority by report reason - lower sorts first. */
const REPORT_PRIORITY: Record<MessageReport['reason'], number> = {
  prohibited_item: 20,
  scam: 20,
  harassment: 25,
  payment: 35,
  contact_sharing: 40,
  spam_ad: 45,
  other: 50,
}

export class ReportNotAllowedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportNotAllowedError'
  }
}

export async function reportMessage(input: {
  message: Message
  reporter: ConversationParticipant
  reason: MessageReport['reason']
  note?: string
}): Promise<{ report: MessageReport; moderationCase: ModerationCase; created: boolean }> {
  const { message, reporter, reason, note } = input

  if (message.senderParticipantId === reporter.id || !message.senderParticipantId) {
    throw new ReportNotAllowedError('You can only report messages others sent you')
  }
  if (!DELIVERED_STATUSES.includes(message.status)) {
    throw new ReportNotAllowedError('This message is no longer visible')
  }

  const existing = await MessageReport.query()
    .where('messageId', message.id)
    .where('reporterParticipantId', reporter.id)
    .first()
  if (existing) {
    const moderationCase = await ModerationCase.findOrFail(existing.caseId)
    return { report: existing, moderationCase, created: false }
  }

  return db.transaction(async (trx) => {
    const priority = REPORT_PRIORITY[reason]
    let moderationCase = await ModerationCase.query({ client: trx })
      .where('messageId', message.id)
      .whereNot('status', 'resolved')
      .forUpdate()
      .first()
    if (moderationCase) {
      if (priority < moderationCase.priority) {
        moderationCase.useTransaction(trx)
        moderationCase.priority = priority
        await moderationCase.save()
      }
    } else {
      moderationCase = await ModerationCase.create(
        {
          uuid: string.uuid(),
          messageId: message.id,
          customerId: message.senderCustomerId,
          vendorId: message.senderVendorId,
          source: reason === 'prohibited_item' ? 'prohibited_item' : 'report',
          priority,
          status: 'open',
          // A report on a delivered message means the automation let it through.
          missedByAutomation: true,
        },
        { client: trx }
      )
    }

    const report = await MessageReport.create(
      {
        uuid: string.uuid(),
        messageId: message.id,
        reporterParticipantId: reporter.id,
        reason,
        note: note ?? null,
        caseId: moderationCase.id,
      },
      { client: trx }
    )
    return { report, moderationCase, created: true }
  })
}
