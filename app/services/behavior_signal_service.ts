/**
 * The behavioral facts the send-time rules need (docs/plans/messaging_moderation.md,
 * section 5 "Sync" column): how much this sender has sent and to how many
 * conversations, whether they're repeating themselves, whether they keep
 * hitting blocks, how widely their links' domains are being spread, and the
 * cached counters on their risk profile. A handful of indexed queries, run
 * before the rules (rules themselves never do I/O).
 */
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type ConversationParticipant from '#models/conversation_participant'
import Conversation from '#models/conversation'
import Customer from '#models/customer'
import Message from '#models/message'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import Vendor from '#models/vendor'
import {
  NEAR_DUPLICATE_THRESHOLD,
  resemblance,
  shingles,
} from '#services/moderation/near_duplicate'
import { buildViews } from '#services/moderation/normalizer'
import { NO_HISTORY } from '#services/moderation/pipeline'
import type { HistoryKeys, HistoryLookups } from '#services/moderation/types'

/** Near-duplicates are compared against this many of the sender's recent messages. */
const NEAR_DUPLICATE_WINDOW = 50
/** Recent messages read for the volume counts - more than any legitimate sender sends in a day. */
const VOLUME_SCAN_LIMIT = 2000

interface Sender {
  customerId: number | null
  vendorId: number | null
}

function bySender(query: any, sender: Sender, prefix = '') {
  return sender.customerId !== null
    ? query.where(`${prefix}sender_customer_id`, sender.customerId)
    : query.where(`${prefix}sender_vendor_id`, sender.vendorId)
}

/** Days since the customer or vendor record was created. */
export async function accountAgeDays(sender: Sender, now = DateTime.now()): Promise<number | null> {
  const record = sender.customerId
    ? await Customer.find(sender.customerId)
    : sender.vendorId
      ? await Vendor.find(sender.vendorId)
      : null
  return record?.createdAt ? Math.floor(now.diff(record.createdAt, 'days').days) : null
}

async function exactDuplicates(sender: Sender, conversationId: number, hash: string) {
  const since = DateTime.now().minus({ hours: 24 }).toSQL()!
  const sameText = await Message.query()
    .where('contentHash', hash)
    .where('createdAt', '>', since)
    .whereNot('conversationId', conversationId)
    .whereNotNull('senderParticipantId')
    .select('conversationId', 'senderCustomerId', 'senderVendorId')

  const mine = (row: Message) =>
    (sender.customerId !== null && row.senderCustomerId === sender.customerId) ||
    (sender.vendorId !== null && row.senderVendorId === sender.vendorId)
  return {
    sameTextOtherConversations: new Set(sameText.filter(mine).map((row) => row.conversationId))
      .size,
    sameTextOtherSenders: new Set(
      sameText
        .filter((row) => !mine(row))
        .map((row) => `${row.senderCustomerId ?? ''}:${row.senderVendorId ?? ''}`)
    ).size,
  }
}

/** Other conversations this sender recently sent nearly the same text to (not identical). */
async function nearDuplicates(
  sender: Sender,
  conversationId: number,
  keys: HistoryKeys
): Promise<number> {
  const current = shingles(keys.normalized)
  if (!current) return 0
  const recent = await bySender(Message.query(), sender)
    .whereNot('conversationId', conversationId)
    .where('kind', 'text')
    .where('createdAt', '>', DateTime.now().minus({ days: 7 }).toSQL()!)
    .orderBy('id', 'desc')
    .limit(NEAR_DUPLICATE_WINDOW)
    .select('conversationId', 'body', 'contentHash')

  const conversations = new Set<number>()
  for (const row of recent as Message[]) {
    if (row.contentHash === keys.contentHash) continue
    const other = shingles(buildViews(row.body).normalized)
    if (other && resemblance(current, other) >= NEAR_DUPLICATE_THRESHOLD) {
      conversations.add(row.conversationId)
    }
  }
  return conversations.size
}

/** Volume over the last hour/day, conversations touched, and recent blocks. */
async function volume(sender: Sender) {
  const now = DateTime.now()
  const hourAgo = now.minus({ hours: 1 })
  const rows = (await bySender(Message.query(), sender)
    .where('createdAt', '>', now.minus({ hours: 24 }).toSQL()!)
    .orderBy('id', 'desc')
    .limit(VOLUME_SCAN_LIMIT)
    .select('conversationId', 'status', 'createdAt')) as Message[]

  const lastHour = rows.filter((row) => row.createdAt && row.createdAt > hourAgo)
  return {
    messagesLastHour: lastHour.length,
    messagesLastDay: rows.length,
    conversationsLastDay: new Set(rows.map((row) => row.conversationId)).size,
    blockedLastHour: lastHour.filter((row) => row.status === 'blocked').length,
  }
}

/** For each domain, distinct other senders who linked to it in the last day. */
async function domainSenders(sender: Sender, domains: string[]): Promise<Record<string, number>> {
  if (domains.length === 0) return {}
  const rows: {
    registrable_domain: string
    sender_customer_id: number | null
    sender_vendor_id: number | null
  }[] = await db
    .from('message_urls')
    .join('messages', 'messages.id', 'message_urls.message_id')
    .whereIn('message_urls.registrable_domain', domains)
    .where('message_urls.created_at', '>', DateTime.now().minus({ hours: 24 }).toSQL()!)
    .whereNotNull('messages.sender_participant_id')
    .distinct(
      'message_urls.registrable_domain',
      'messages.sender_customer_id',
      'messages.sender_vendor_id'
    )

  const counts: Record<string, number> = {}
  for (const row of rows) {
    const self =
      (sender.customerId !== null && row.sender_customer_id === sender.customerId) ||
      (sender.vendorId !== null && row.sender_vendor_id === sender.vendorId)
    if (!self) counts[row.registrable_domain] = (counts[row.registrable_domain] ?? 0) + 1
  }
  return counts
}

/** Customers: distinct vendors they've opened inquiries with in the last 7 days. */
async function vendorsContacted(sender: Sender): Promise<number> {
  if (sender.customerId === null) return 0
  const row = await Conversation.query()
    .where('kind', 'inquiry')
    .where('customerId', sender.customerId)
    .where('createdAt', '>', DateTime.now().minus({ days: 7 }).toSQL()!)
    .countDistinct('vendor_id as total')
    .first()
  return Number(row?.$extras.total ?? 0)
}

async function profileCounters(sender: Sender) {
  const profile = await MessagingRiskProfile.query()
    .if(sender.customerId !== null, (query) => query.where('customerId', sender.customerId!))
    .if(sender.customerId === null, (query) => query.where('vendorId', sender.vendorId!))
    .first()
  return {
    deliveredMessages: profile?.deliveredMessages ?? 0,
    reportsReceived30d: profile?.reportsReceived ?? 0,
    vendorBlocks30d: profile?.vendorBlocks ?? 0,
    confirmedViolations30d: profile?.confirmedViolations ?? 0,
  }
}

/** Everything the behavioral rules read about a sender, for one message. */
export async function behaviorLookups(
  participant: Pick<ConversationParticipant, 'customerId' | 'vendorId'>,
  conversationId: number,
  keys: HistoryKeys
): Promise<HistoryLookups> {
  const sender: Sender = { customerId: participant.customerId, vendorId: participant.vendorId }
  if (sender.customerId === null && sender.vendorId === null) {
    // Staff: exempt from behavioral rules (their messages are still logged).
    return NO_HISTORY
  }

  const [exact, near, counts, spread, vendors, counters, age] = await Promise.all([
    exactDuplicates(sender, conversationId, keys.contentHash),
    nearDuplicates(sender, conversationId, keys),
    volume(sender),
    domainSenders(sender, keys.domains),
    vendorsContacted(sender),
    profileCounters(sender),
    accountAgeDays(sender),
  ])
  return {
    ...exact,
    nearDuplicateOtherConversations: near,
    ...counts,
    domainSenders: spread,
    vendorsContactedWeek: vendors,
    accountAgeDays: age,
    ...counters,
  }
}
