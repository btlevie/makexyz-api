/**
 * Labelled messages exported as anonymized fixtures (docs/plans/
 * messaging_moderation.md, section 6 step 7) - the examples a new rule is
 * tested against, and what grows the regression corpus. Anonymized:
 * emails and phone numbers become placeholders, links keep only their
 * registrable domain (the signal) and lose their path and query, and no
 * names, ids or uuids from our records are included. Free-text names in a
 * message body can't be detected reliably, so review an export before
 * committing it.
 */
import { type DateTime } from 'luxon'
import Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'
import Message from '#models/message'
import MessageUrl from '#models/message_url'
import ModerationCase from '#models/moderation_case'
import Order from '#models/order'
import { redact } from '#services/llm_moderation_service'
import { labelOf, type ReplayLabel } from '#services/moderation_replay_service'

export interface CorpusEntry {
  label: ReplayLabel
  category: string | null
  note: string | null
  role: string
  kind: string
  orderStatus: string | null
  text: string
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The body with links reduced to their domain and contact details redacted. */
export function anonymize(body: string, urls: MessageUrl[]): string {
  let text = body
  for (const url of [...urls].sort((a, b) => b.match.length - a.match.length)) {
    const replacement = `https://${url.registrableDomain ?? 'link.invalid'}/...`
    text = text.replace(new RegExp(escapeRegExp(url.match), 'gi'), () => replacement)
  }
  return redact(text)
}

export async function exportCorpus(options: {
  since: DateTime
  labelledOnly?: boolean
  limit?: number
}): Promise<CorpusEntry[]> {
  const messages = await Message.query()
    .where('kind', 'text')
    .whereNotNull('senderParticipantId')
    .where('createdAt', '>', options.since.toSQL()!)
    .orderBy('id', 'asc')
    .limit(options.limit ?? 5000)
  const ids = messages.map((message) => message.id)
  const [cases, urls, participants, conversations] = await Promise.all([
    ModerationCase.query().whereIn('messageId', ids),
    MessageUrl.query().whereIn('messageId', ids),
    ConversationParticipant.query().whereIn(
      'id',
      messages.map((message) => message.senderParticipantId!)
    ),
    Conversation.query().whereIn(
      'id',
      messages.map((message) => message.conversationId)
    ),
  ])
  const orders = await Order.query().whereIn(
    'id',
    conversations
      .map((conversation) => conversation.orderId)
      .filter((id): id is number => id !== null)
  )

  const entries: CorpusEntry[] = []
  for (const message of messages) {
    const own = cases.filter((moderationCase) => moderationCase.messageId === message.id)
    const label = labelOf(message, own)
    if (label === 'unlabelled' || (options.labelledOnly && own.length === 0)) continue
    const conversation = conversations.find((row) => row.id === message.conversationId)
    const labelled = own.find((moderationCase) => moderationCase.abuseCategory)
    entries.push({
      label,
      category: labelled?.abuseCategory ?? null,
      note: labelled?.patternNote ?? null,
      role:
        participants.find((participant) => participant.id === message.senderParticipantId)?.role ??
        'unknown',
      kind: conversation?.kind ?? 'unknown',
      orderStatus: orders.find((order) => order.id === conversation?.orderId)?.status ?? null,
      text: anonymize(
        message.body,
        urls.filter((url) => url.messageId === message.id)
      ),
    })
  }
  return entries
}
