/**
 * Sending messages: every submission is moderated before anyone else can see
 * it, stored whatever the outcome, and ordered by a gap-free per-conversation
 * sequence. See docs/plans/messaging_moderation.md ("Message lifecycle",
 * "Ordering, threading, duplicates, retries, idempotency").
 *
 * Outcome -> message status:
 *   allow    -> delivered
 *   flag     -> delivered_flagged (visible now, queued for a later look)
 *   escalate -> pending_review    (no automated deep analysis yet - a person decides)
 *   review   -> pending_review
 *   block    -> blocked           (only the sender sees it, with the reason)
 * A restricted sender's messages always go to pending_review.
 */
import string from '@adonisjs/core/helpers/string'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import transmit from '@adonisjs/transmit/services/main'
import { DateTime } from 'luxon'
import Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'
import Message, { DELIVERED_STATUSES } from '#models/message'
import ModerationCase from '#models/moderation_case'
import ModerationEvaluation from '#models/moderation_evaluation'
import ModerationRuleHit from '#models/moderation_rule_hit'
import Order from '#models/order'
import { assertCanPost } from '#services/conversation_service'
import { effectiveTrustTier } from '#services/messaging_risk_service'
import { scheduleNotifications } from '#services/message_notification_service'
import {
  moderateMessage,
  PIPELINE_VERSION,
  type ModerationOutcome,
} from '#services/moderation/pipeline'
import type { ConversationContext, Decision, HistoryLookups } from '#services/moderation/types'

/** Review-queue priority: lower sorts first. Someone waiting on a held message comes first. */
const HELD_MESSAGE_PRIORITY = 10
const FLAGGED_MESSAGE_PRIORITY = 80

export class MessagingSuspendedError extends Error {
  constructor() {
    super('Your messaging is suspended. Please contact MakeXYZ support.')
    this.name = 'MessagingSuspendedError'
  }
}

export interface SubmitMessageInput {
  conversation: Conversation
  participant: ConversationParticipant
  body: string
  clientMessageId: string
}

export interface SubmitMessageResult {
  message: Message
  /** False when this was a retry of a message already sent with the same clientMessageId. */
  created: boolean
}

/** The transmit channel a conversation's participants subscribe to (see start/transmit.ts). */
export function conversationChannel(conversation: Conversation): string {
  return `conversations/${conversation.uuid}`
}

/**
 * Shown to the sender when the blocking rule gives no specific reason - spam,
 * scam and malicious-link rules deliberately don't explain themselves.
 */
export const GENERIC_BLOCK_REASON = "This message couldn't be delivered."

/** A blocked prohibited-item message still goes to staff. */
const PROHIBITED_ITEM_PRIORITY = 30

/**
 * The behavioral facts the duplicate-spam rule needs, over the last 24 hours:
 * how many other conversations this sender sent the same text to, and how
 * many other senders sent it.
 */
async function historyFor(
  participant: ConversationParticipant,
  conversationId: number,
  hash: string
): Promise<HistoryLookups> {
  const since = DateTime.now().minus({ hours: 24 }).toSQL()!
  const sameText = await Message.query()
    .where('contentHash', hash)
    .where('createdAt', '>', since)
    .whereNot('conversationId', conversationId)
    .whereNotNull('senderParticipantId')
    .select('conversationId', 'senderCustomerId', 'senderVendorId')

  const mine = (row: Message) =>
    (participant.customerId !== null && row.senderCustomerId === participant.customerId) ||
    (participant.vendorId !== null && row.senderVendorId === participant.vendorId)
  const otherConversations = new Set(sameText.filter(mine).map((row) => row.conversationId))
  const otherSenders = new Set(
    sameText
      .filter((row) => !mine(row))
      .map((row) => `${row.senderCustomerId ?? ''}:${row.senderVendorId ?? ''}`)
  )
  return {
    sameTextOtherConversations: otherConversations.size,
    sameTextOtherSenders: otherSenders.size,
  }
}

async function conversationContext(conversation: Conversation): Promise<ConversationContext> {
  const order = conversation.orderId ? await Order.find(conversation.orderId) : null
  return {
    kind: conversation.kind,
    isFirstMessage: conversation.kind === 'inquiry' && conversation.lastSeq === 0,
    orderStatus: order?.status ?? null,
  }
}

function statusFor(decision: Decision, restricted: boolean): Message['status'] {
  if (decision === 'block') return 'blocked'
  if (decision === 'review' || decision === 'escalate' || restricted) return 'pending_review'
  if (decision === 'flag') return 'delivered_flagged'
  return 'delivered'
}

async function findExisting(participant: ConversationParticipant, clientMessageId: string) {
  return Message.query()
    .where('senderParticipantId', participant.id)
    .where('clientMessageId', clientMessageId)
    .first()
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code
  return code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT'
}

/**
 * Locks the conversation row and reserves the next sequence number. Every
 * message insert goes through here, which is what keeps `seq` gap-free and
 * totally ordered per conversation.
 */
async function lockAndReserveSeq(conversationId: number, trx: TransactionClientContract) {
  const locked = await Conversation.query({ client: trx })
    .where('id', conversationId)
    .forUpdate()
    .firstOrFail()
  locked.lastSeq += 1
  return locked
}

async function recordEvaluation(
  message: Message,
  outcome: ModerationOutcome,
  trx: TransactionClientContract
) {
  const evaluation = await ModerationEvaluation.create(
    {
      messageId: message.id,
      stage: 'sync',
      pipelineVersion: PIPELINE_VERSION,
      decision: outcome.decision,
      riskScore: outcome.riskScore,
      signals: outcome.signals,
      rulesEvaluated: outcome.rulesEvaluated,
      durationMs: outcome.durationMs,
    },
    { client: trx }
  )
  if (outcome.hits.length > 0) {
    await ModerationRuleHit.createMany(
      outcome.hits.map((hit) => ({ ...hit, evaluationId: evaluation.id, messageId: message.id })),
      { client: trx }
    )
  }
}

/** Applies the "a message was delivered" bookkeeping to a locked conversation row. */
function markDelivered(
  locked: Conversation,
  senderRole: ConversationParticipant['role'] | null,
  now: DateTime
) {
  locked.lastMessageAt = now
  if (senderRole === 'customer') {
    locked.firstCustomerMessageDeliveredAt ??= now
  } else if (senderRole === 'vendor') {
    locked.firstVendorResponseAt ??= now
  }
}

/**
 * Sends a message from a participant: idempotency check, posting rules,
 * moderation, then one transaction for the message, its evaluation, rule hits
 * and (if held) a review case. Delivery side effects run after commit.
 */
export async function submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult> {
  const { conversation, participant, body, clientMessageId } = input

  const existing = await findExisting(participant, clientMessageId)
  if (existing) {
    return { message: existing, created: false }
  }

  const posting = await assertCanPost(conversation, participant)

  const principal = { customerId: participant.customerId, vendorId: participant.vendorId }
  const tier = await effectiveTrustTier(principal)
  // Suspended senders can still reach a live order's counterpart (so
  // fulfilment isn't stranded), but every message waits for a person.
  if (tier === 'suspended' && conversation.kind !== 'order') {
    throw new MessagingSuspendedError()
  }
  const restricted = tier === 'restricted' || tier === 'suspended'

  const outcome = await moderateMessage({
    text: body,
    senderRole: participant.role,
    channel: 'web',
    conversation: await conversationContext(conversation),
    trustTier: tier,
    history: (hash) => historyFor(participant, conversation.id, hash),
  })
  const status = statusFor(outcome.decision, restricted)
  const now = DateTime.now()

  let message: Message
  try {
    message = await db.transaction(async (trx) => {
      const locked = await lockAndReserveSeq(conversation.id, trx)
      if (posting === 'reopen') {
        locked.merge({ status: 'open', closedReason: null, readOnlyAt: null })
      }
      if (DELIVERED_STATUSES.includes(status)) {
        markDelivered(locked, participant.role, now)
      }

      const created = await Message.create(
        {
          uuid: string.uuid(),
          conversationId: conversation.id,
          senderParticipantId: participant.id,
          senderCustomerId: participant.customerId,
          senderVendorId: participant.vendorId,
          seq: locked.lastSeq,
          kind: 'text',
          channel: 'web',
          body,
          clientMessageId,
          status,
          blockReasonCode: status === 'delivered' ? null : outcome.reasonCode,
          userFacingReason:
            status === 'blocked' ? (outcome.userFacingReason ?? GENERIC_BLOCK_REASON) : null,
          contentHash: outcome.contentHash,
          deliveredAt: DELIVERED_STATUSES.includes(status) ? now : null,
        },
        { client: trx }
      )
      await locked.save()
      await recordEvaluation(created, outcome, trx)

      if (status === 'blocked' && outcome.caseSource) {
        await ModerationCase.create(
          {
            uuid: string.uuid(),
            messageId: created.id,
            customerId: participant.customerId,
            vendorId: participant.vendorId,
            source: outcome.caseSource,
            priority: PROHIBITED_ITEM_PRIORITY,
            status: 'open',
            missedByAutomation: false,
          },
          { client: trx }
        )
      }
      if (status === 'pending_review' || status === 'delivered_flagged') {
        await ModerationCase.create(
          {
            uuid: string.uuid(),
            messageId: created.id,
            customerId: participant.customerId,
            vendorId: participant.vendorId,
            source: status === 'pending_review' ? 'auto_hold' : 'auto_flag',
            priority:
              status === 'pending_review' ? HELD_MESSAGE_PRIORITY : FLAGGED_MESSAGE_PRIORITY,
            status: 'open',
            missedByAutomation: false,
          },
          { client: trx }
        )
      }

      conversation.merge(locked.$attributes)
      return created
    })
  } catch (error) {
    // A concurrent retry with the same clientMessageId won the race.
    if (isUniqueViolation(error)) {
      const winner = await findExisting(participant, clientMessageId)
      if (winner) return { message: winner, created: false }
    }
    throw error
  }

  if (DELIVERED_STATUSES.includes(message.status)) {
    await afterDelivery(conversation, message)
  }
  return { message, created: true }
}

/**
 * Delivers a message that was held for review (moderation_case_service.ts).
 * It keeps its original seq, so it appears where it was sent.
 */
export async function deliverHeldMessage(message: Message): Promise<Message> {
  const now = DateTime.now()
  const conversation = await db.transaction(async (trx) => {
    const locked = await Conversation.query({ client: trx })
      .where('id', message.conversationId)
      .forUpdate()
      .firstOrFail()
    const sender = message.senderParticipantId
      ? await ConversationParticipant.find(message.senderParticipantId, { client: trx })
      : null
    markDelivered(locked, sender?.role ?? null, now)
    await locked.save()

    message.useTransaction(trx)
    message.merge({ status: 'delivered', deliveredAt: now, blockReasonCode: null })
    await message.save()
    return locked
  })

  await afterDelivery(conversation, message)
  return message
}

/**
 * A MakeXYZ-authored line in the thread ("The manufacturer declined this
 * inquiry"). Not moderated, always delivered, notifies every participant.
 */
export async function postSystemMessage(
  conversation: Conversation,
  body: string,
  ref?: { kind: 'quote_ref'; type: string; id: number }
): Promise<Message> {
  const now = DateTime.now()
  const message = await db.transaction(async (trx) => {
    const locked = await lockAndReserveSeq(conversation.id, trx)
    locked.lastMessageAt = now
    const created = await Message.create(
      {
        uuid: string.uuid(),
        conversationId: conversation.id,
        seq: locked.lastSeq,
        kind: ref?.kind ?? 'system',
        refType: ref?.type ?? null,
        refId: ref?.id ?? null,
        channel: 'system',
        body,
        status: 'delivered',
        deliveredAt: now,
      },
      { client: trx }
    )
    await locked.save()
    conversation.merge(locked.$attributes)
    return created
  })

  await afterDelivery(conversation, message)
  return message
}

/**
 * Tells online participants (transmit) and schedules email for the others.
 * Best-effort: the message is already safely stored and delivered.
 */
async function afterDelivery(conversation: Conversation, message: Message) {
  try {
    transmit.broadcast(conversationChannel(conversation), {
      event: 'message.delivered',
      messageUuid: message.uuid,
      seq: message.seq,
    })
  } catch (error) {
    logger.error(
      { conversationUuid: conversation.uuid, error: String(error) },
      'Failed to broadcast a delivered message'
    )
  }
  await scheduleNotifications(conversation, message)
}
