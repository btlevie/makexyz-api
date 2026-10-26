/**
 * The daily admin digest (docs/plans/messaging_moderation.md, D8): when any
 * sender is waiting on a held message, every admin gets one email with how
 * many, how long the oldest has waited, and the open queue by source. No
 * email when nobody is waiting. Best-effort: a mail failure is logged.
 */
import logger from '@adonisjs/core/services/logger'
import mail from '@adonisjs/mail/services/main'
import { DateTime } from 'luxon'
import ModerationDigestNotification from '#mails/moderation_digest_notification'
import ModerationCase from '#models/moderation_case'
import User from '#models/user'

export async function sendModerationDigest(): Promise<number> {
  const open = await ModerationCase.query().whereNot('status', 'resolved').preload('message')
  const waiting = open.filter(
    (moderationCase) =>
      moderationCase.message?.status === 'pending_review' ||
      moderationCase.message?.status === 'held'
  )
  if (waiting.length === 0) {
    return 0
  }

  const oldest = waiting
    .map((moderationCase) => moderationCase.createdAt)
    .filter((createdAt): createdAt is DateTime => createdAt !== null)
    .sort((a, b) => a.toMillis() - b.toMillis())[0]
  const bySource: Record<string, number> = {}
  for (const moderationCase of open) {
    bySource[moderationCase.source] = (bySource[moderationCase.source] ?? 0) + 1
  }
  const counts = {
    waiting: waiting.length,
    oldestWaitingHours: oldest ? Math.floor(DateTime.now().diff(oldest, 'hours').hours) : null,
    bySource,
  }

  const admins = await User.query().where('role', 'admin')
  let sent = 0
  for (const admin of admins) {
    try {
      await mail.send(new ModerationDigestNotification(admin.email, counts, null))
      sent++
    } catch (error) {
      logger.error(
        { adminId: admin.id, error: String(error) },
        'Failed to send the moderation digest'
      )
    }
  }
  return sent
}
