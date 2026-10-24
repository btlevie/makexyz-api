/**
 * Email notifications for new messages - debounced, so a burst of messages
 * becomes one email (docs/plans/messaging_moderation.md, "Notification
 * retries"). The first delivered message schedules a job NOTIFICATION_DELAY
 * out; later ones within that window are absorbed by the job's dedup key. The
 * job emails everything delivered since the participant's `last_notified_seq`
 * that they haven't already read, then advances that cursor.
 */
import logger from '@adonisjs/core/services/logger'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import SendMessageNotifications from '#jobs/send_message_notifications'
import NewMessageNotification, { type NotificationPreview } from '#mails/new_message_notification'
import Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'
import Customer from '#models/customer'
import Message from '#models/message'
import MessageUrl from '#models/message_url'
import User from '#models/user'
import Vendor from '#models/vendor'
import { effectiveTrustTier } from '#services/messaging_risk_service'

export const NOTIFICATION_DELAY = '3m'

/** At most this many message previews in one email. */
const MAX_PREVIEWS = 3

/** Queues a (debounced) notification for everyone in the thread but the sender. */
export async function scheduleNotifications(conversation: Conversation, message: Message) {
  try {
    const recipients = await ConversationParticipant.query()
      .where('conversationId', conversation.id)
      .where('emailNotifications', true)
      .whereNull('removedAt')
      .if(message.senderParticipantId, (query) =>
        query.whereNot('id', message.senderParticipantId!)
      )

    for (const recipient of recipients) {
      await SendMessageNotifications.dispatch({ participantId: recipient.id })
        .in(NOTIFICATION_DELAY)
        .dedup({ id: `participant-${recipient.id}`, ttl: NOTIFICATION_DELAY })
        .run()
    }
  } catch (error) {
    logger.error(
      { conversationUuid: conversation.uuid, error: String(error) },
      'Failed to schedule message notifications'
    )
  }
}

async function recipientAddress(
  participant: ConversationParticipant
): Promise<{ email: string; isGuest: boolean } | null> {
  if (participant.role === 'customer' && participant.customerId) {
    const customer = await Customer.find(participant.customerId)
    if (customer?.userId) {
      const user = await User.find(customer.userId)
      return user ? { email: user.email, isGuest: false } : null
    }
    return customer?.email ? { email: customer.email, isGuest: true } : null
  }
  if (participant.role === 'vendor' && participant.vendorId) {
    const vendor = await Vendor.find(participant.vendorId)
    const user = vendor?.userId ? await User.find(vendor.userId) : null
    return user ? { email: user.email, isGuest: false } : null
  }
  if (participant.userId) {
    const user = await User.find(participant.userId)
    return user ? { email: user.email, isGuest: false } : null
  }
  return null
}

/**
 * Message text goes in the email only when it's certain to stay: delivered
 * and unflagged, from an established (standard/trusted) sender, and the
 * recipient has an account. Everyone starts in the 'new' tier, so until
 * trust tiers are promoted automatically this is effectively always off.
 */
async function previewsFor(
  messages: Message[],
  recipientIsGuest: boolean
): Promise<NotificationPreview[] | null> {
  if (recipientIsGuest) {
    return null
  }
  const previews: NotificationPreview[] = []
  for (const message of messages.slice(-MAX_PREVIEWS)) {
    if (message.status !== 'delivered') {
      return null
    }
    if (message.kind === 'text') {
      const tier = await effectiveTrustTier({
        customerId: message.senderCustomerId,
        vendorId: message.senderVendorId,
      })
      if (tier !== 'standard' && tier !== 'trusted') {
        return null
      }
    }
    const sender = message.senderParticipantId
      ? await ConversationParticipant.find(message.senderParticipantId)
      : null
    previews.push({ from: sender?.displayName ?? 'MakeXYZ', body: await withSafeLinks(message) })
  }
  return previews
}

/**
 * The body with every link swapped for its interstitial (LINKS_URL/<token>),
 * so an email never carries a raw URL - a link taken down later can't be
 * followed from someone's inbox. With no interstitial configured, links are
 * replaced by a placeholder rather than sent raw.
 */
async function withSafeLinks(message: Message): Promise<string> {
  const links = await MessageUrl.query().where('messageId', message.id)
  if (links.length === 0) return message.body
  const base = env.get('LINKS_URL')
  let body = message.body
  // Longest first, so a link that contains another is replaced whole. Matches
  // come from the lowercased text view, hence case-insensitive.
  for (const link of links.sort((a, b) => b.match.length - a.match.length)) {
    const replacement = base ? `${base}/${link.token}` : '[link - view it on MakeXYZ]'
    const pattern = new RegExp(link.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    body = body.replace(pattern, () => replacement)
  }
  return body
}

function conversationUrl(conversation: Conversation): string | null {
  const page = env.get('MESSAGES_URL')
  return page ? `${page}/${conversation.uuid}` : null
}

/**
 * Sends the pending digest for one participant, if there's anything unread
 * and not yet emailed. Returns whether an email was sent. Safe to run twice:
 * the cursor only moves forward, so a retry either finds nothing new or
 * re-sends the same batch at most once.
 */
export async function sendPendingNotification(participantId: number): Promise<boolean> {
  const participant = await ConversationParticipant.find(participantId)
  if (!participant || !participant.emailNotifications || participant.removedAt) {
    return false
  }
  const conversation = await Conversation.findOrFail(participant.conversationId)

  const since = Math.max(participant.lastNotifiedSeq, participant.lastReadSeq)
  const unread = await Message.query()
    .where('conversationId', conversation.id)
    .where('seq', '>', since)
    .whereIn('status', ['delivered', 'delivered_flagged'])
    .where((query) =>
      query.whereNull('senderParticipantId').orWhereNot('senderParticipantId', participant.id)
    )
    .orderBy('seq', 'asc')
  if (unread.length === 0) {
    return false
  }

  const recipient = await recipientAddress(participant)
  if (!recipient) {
    return false
  }

  await mail.send(
    new NewMessageNotification(recipient.email, {
      conversationTitle: conversation.subject ?? 'your MakeXYZ conversation',
      messageCount: unread.length,
      conversationUrl: conversationUrl(conversation),
      previews: await previewsFor(unread, recipient.isGuest),
      recipientIsGuest: recipient.isGuest,
    })
  )

  const lastSeq = unread[unread.length - 1].seq
  await ConversationParticipant.query()
    .where('id', participant.id)
    .where('lastNotifiedSeq', '<', lastSeq)
    .update({ last_notified_seq: lastSeq })
  return true
}
