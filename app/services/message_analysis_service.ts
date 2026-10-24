/**
 * The async moderation pass (docs/plans/messaging_moderation.md, "Delivery
 * timing"). A message the send-time pass couldn't decide - an unverified
 * link, an attachment still being scanned - is stored as 'held'. Once its
 * links are analysed (url_analysis_service.ts) and its attachments checked
 * (attachment_service.ts), it's judged again by the same rules with the new
 * facts, and delivered, flagged, held for a person or blocked.
 *
 * Also here: the retroactive rescan (a link that turns malicious later is
 * removed from every message containing it) and the sweep that makes sure
 * nothing waits in 'held' indefinitely.
 */
import string from '@adonisjs/core/helpers/string'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import transmit from '@adonisjs/transmit/services/main'
import { DateTime } from 'luxon'
import Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'
import Message, { DELIVERED_STATUSES } from '#models/message'
import MessageAttachment from '#models/message_attachment'
import ModerationCase from '#models/moderation_case'
import {
  attachmentInputs,
  conversationChannel,
  conversationContext,
  deliverHeldMessage,
  GENERIC_BLOCK_REASON,
  openMessageCase,
  queueAnalysis,
  recordEvaluation,
  recordMessageUrls,
  statusFor,
} from '#services/message_service'
import { behaviorLookups } from '#services/behavior_signal_service'
import { effectiveTrustTier, noteBlockedAttempt } from '#services/messaging_risk_service'
import type { HistoryKeys } from '#services/moderation/types'
import { moderateMessage, type ModerationOutcome } from '#services/moderation/pipeline'
import { analyzeUrl } from '#services/url_analysis_service'

/** A held message older than this gets a final pass by SweepHeldMessages. */
const HELD_SWEEP_AFTER_MINUTES = 20
/** Links re-checked per RescanRecentUrls run - the rest wait for the next run. */
const RESCAN_BATCH = 500
const RESCAN_WINDOW_DAYS = 30
const RESCAN_CASE_PRIORITY = 20

/** Moves a held message to a person's queue (analysis failed or ran out of time). */
export async function releaseHeldMessage(messageId: number, reasonCode: string) {
  await db.transaction(async (trx) => {
    const message = await Message.query({ client: trx }).where('id', messageId).forUpdate().first()
    if (!message || message.status !== 'held') return
    message.merge({ status: 'pending_review', blockReasonCode: reasonCode })
    await message.save()
    await openMessageCase(message, 'auto_hold', trx)
  })
}

async function applyOutcome(
  messageId: number,
  outcome: ModerationOutcome,
  status: Message['status']
): Promise<Message | null> {
  const message = await db.transaction(async (trx) => {
    const locked = await Message.query({ client: trx }).where('id', messageId).forUpdate().first()
    // Someone else decided it meanwhile (a moderator, a parallel pass, a withdrawal).
    if (!locked || locked.status !== 'held') return null

    await recordEvaluation(locked, outcome, trx, 'async')
    await recordMessageUrls(locked, outcome, trx)

    if (status === 'blocked') {
      locked.merge({
        status,
        blockReasonCode: outcome.reasonCode,
        userFacingReason: outcome.userFacingReason ?? GENERIC_BLOCK_REASON,
      })
      await locked.save()
      if (outcome.caseSource) await openMessageCase(locked, outcome.caseSource, trx)
    } else if (status === 'pending_review') {
      locked.merge({ status, blockReasonCode: outcome.reasonCode ?? 'analysis_incomplete' })
      await locked.save()
      await openMessageCase(locked, 'auto_hold', trx)
    } else if (status === 'delivered_flagged') {
      locked.merge({ blockReasonCode: outcome.reasonCode })
      await locked.save()
      await openMessageCase(locked, 'auto_flag', trx)
    }
    return locked
  })

  if (message && status === 'blocked') {
    await noteBlockedAttempt(message)
  }
  if (message && (status === 'delivered' || status === 'delivered_flagged')) {
    await deliverHeldMessage(message, status)
  }
  return message
}

export interface AnalyzeHeldOptions {
  /** Last chance: whatever is still undecided goes to a person. */
  final?: boolean
}

/**
 * Judges a held message again once its links and attachments are analysed.
 * Safe to run repeatedly: it no-ops unless the message is still held, and
 * leaves it held (unless `final`) while attachments are still being scanned.
 */
export async function analyzeHeldMessage(messageId: number, options: AnalyzeHeldOptions = {}) {
  const message = await Message.find(messageId)
  if (!message || message.status !== 'held') {
    return
  }
  const sender = message.senderParticipantId
    ? await ConversationParticipant.find(message.senderParticipantId)
    : null
  if (!sender) {
    return releaseHeldMessage(message.id, 'analysis_no_sender')
  }
  const conversation = await Conversation.findOrFail(message.conversationId)
  const attachments = await MessageAttachment.query().where('messageId', message.id)
  const tier = await effectiveTrustTier({
    customerId: sender.customerId,
    vendorId: sender.vendorId,
  })

  const input = {
    text: message.body,
    senderRole: sender.role,
    channel: message.channel === 'email' ? ('email' as const) : ('web' as const),
    conversation: await conversationContext(conversation),
    trustTier: tier,
    history: (keys: HistoryKeys) => behaviorLookups(sender, conversation.id, keys),
    ...attachmentInputs(attachments),
  }

  // First pass finds the links still needing analysis; the second judges with the results.
  let outcome = await moderateMessage(input)
  if (outcome.decision === 'hold') {
    const pending = outcome.signals.urls.filter((url) => !url.allowlisted && url.scan === null)
    for (const url of pending) {
      await analyzeUrl(url.url)
    }
    if (pending.length > 0) {
      outcome = await moderateMessage(input)
    }
  }

  const restricted = tier === 'restricted' || tier === 'suspended'
  let status = statusFor(outcome.decision, restricted)
  if (status === 'held') {
    if (!options.final) {
      return
    }
    status = 'pending_review'
  }
  await applyOutcome(message.id, outcome, status)
}

/** Removes delivered messages containing a link that turned malicious, opening a case for each. */
async function removeMessagesWithUrl(urlHash: string): Promise<number> {
  const messages = await Message.query()
    .whereIn('status', DELIVERED_STATUSES)
    .whereIn('id', (query) =>
      query.from('message_urls').where('url_hash', urlHash).select('message_id')
    )
  for (const message of messages) {
    await db.transaction(async (trx) => {
      message.useTransaction(trx)
      message.merge({ status: 'removed', removedAt: DateTime.now(), blockReasonCode: 'url_rescan' })
      await message.save()
      await ModerationCase.create(
        {
          uuid: string.uuid(),
          messageId: message.id,
          customerId: message.senderCustomerId,
          vendorId: message.senderVendorId,
          source: 'url_rescan',
          priority: RESCAN_CASE_PRIORITY,
          status: 'open',
          // It got through at send time - exactly what the discovery loop learns from.
          missedByAutomation: true,
        },
        { client: trx }
      )
    })
    const conversation = await Conversation.find(message.conversationId)
    if (conversation) {
      try {
        transmit.broadcast(conversationChannel(conversation), {
          event: 'message.removed',
          messageUuid: message.uuid,
          seq: message.seq,
        })
      } catch (error) {
        logger.error({ error: String(error) }, 'Failed to broadcast a removed message')
      }
    }
  }
  return messages.length
}

/**
 * Re-checks links sent in the last 30 days whose cached verdict has expired;
 * any that are now malicious are taken down everywhere they were sent. The
 * click-through interstitial re-checks at click time too, so a takedown also
 * protects people who already have the message open.
 */
export async function rescanRecentUrls(): Promise<{ rescanned: number; removed: number }> {
  const now = DateTime.now().toSQL()!
  const since = DateTime.now().minus({ days: RESCAN_WINDOW_DAYS }).toSQL()!
  const rows: { url_hash: string; normalized_url: string }[] = await db
    .from('message_urls')
    .join('messages', 'messages.id', 'message_urls.message_id')
    .leftJoin('url_scans', 'url_scans.url_hash', 'message_urls.url_hash')
    .where('messages.created_at', '>', since)
    .whereIn('messages.status', DELIVERED_STATUSES)
    .where((query) => query.whereNull('url_scans.id').orWhere('url_scans.expires_at', '<', now))
    .distinct('message_urls.url_hash', 'message_urls.normalized_url')
    .limit(RESCAN_BATCH)

  let removed = 0
  for (const row of rows) {
    try {
      const scan = await analyzeUrl(row.normalized_url, { force: true })
      if (scan.verdict === 'malicious') {
        removed += await removeMessagesWithUrl(row.url_hash)
      }
    } catch (error) {
      logger.warn({ url: row.normalized_url, error: String(error) }, 'Rescan of a link failed')
    }
  }
  return { rescanned: rows.length, removed }
}

/** Gives long-held messages a final pass, so nothing stays held indefinitely. */
export async function sweepHeldMessages(): Promise<number> {
  const cutoff = DateTime.now().minus({ minutes: HELD_SWEEP_AFTER_MINUTES }).toSQL()!
  const stale = await Message.query()
    .where('status', 'held')
    .where('createdAt', '<', cutoff)
    .limit(200)
  for (const message of stale) {
    await queueAnalysis(message, true)
  }
  return stale.length
}
