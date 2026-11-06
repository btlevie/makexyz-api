/**
 * Vendor response rate and time, from inquiry conversations
 * (docs/plans/manual_quotes.md, 2e). Cached on the vendor row, because search
 * ranks on the rate (responseFactor) and both show on the profile.
 *
 * - Rate: of the vendor's inquiries in the last 90 days whose opening message
 *   was delivered, the share answered (a reply or a decline) within 7 days.
 *   Inquiries whose opener a moderator later removed, and ones where the
 *   vendor blocked or reported the customer, don't count. An inquiry under 7
 *   days old with no answer yet doesn't count either way.
 * - Time: the median hours to the first answer over the 6 most recent
 *   answered inquiries.
 *
 * The inputs are conversations.first_customer_message_delivered_at and
 * first_vendor_response_at (set by message_service.ts and declineInquiry), so
 * this never scans messages beyond the exclusions.
 */
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import vendorSearchConfig from '#config/vendor_search'
import Conversation from '#models/conversation'
import Vendor from '#models/vendor'

export interface ResponseStats {
  responseRate: number | null
  responseTimeHours: number | null
  counted: number
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Inquiry ids to leave out: opener removed by a moderator, or the vendor blocked/reported the customer. */
async function excludedConversationIds(vendorId: number, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set()
  const [removed, reported, blocked] = await Promise.all([
    db
      .from('messages')
      .whereIn('conversation_id', ids)
      .whereNotNull('sender_customer_id')
      .where('status', 'removed')
      .select('conversation_id'),
    db
      .from('message_reports')
      .join('messages', 'messages.id', 'message_reports.message_id')
      .join(
        'conversation_participants',
        'conversation_participants.id',
        'message_reports.reporter_participant_id'
      )
      .whereIn('messages.conversation_id', ids)
      .where('conversation_participants.role', 'vendor')
      .select('messages.conversation_id'),
    db
      .from('conversations')
      .join('conversation_blocks', (join) => {
        join
          .on('conversation_blocks.customer_id', '=', 'conversations.customer_id')
          .andOn('conversation_blocks.vendor_id', '=', 'conversations.vendor_id')
      })
      .whereIn('conversations.id', ids)
      .where('conversations.vendor_id', vendorId)
      .select('conversations.id as conversation_id'),
  ])
  return new Set([...removed, ...reported, ...blocked].map((row) => Number(row.conversation_id)))
}

export async function computeResponseStats(
  vendorId: number,
  now = DateTime.now()
): Promise<ResponseStats> {
  const { windowDays, responseDays, timeSampleSize } = vendorSearchConfig.response
  const inquiries = await Conversation.query()
    .where('vendorId', vendorId)
    .where('kind', 'inquiry')
    .whereNotNull('firstCustomerMessageDeliveredAt')
    .where('firstCustomerMessageDeliveredAt', '>=', now.minus({ days: windowDays }).toSQL()!)
  const excluded = await excludedConversationIds(
    vendorId,
    inquiries.map((inquiry) => inquiry.id)
  )

  let counted = 0
  let responded = 0
  const answered: { at: DateTime; hours: number }[] = []
  for (const inquiry of inquiries) {
    if (excluded.has(inquiry.id)) continue
    const deliveredAt = inquiry.firstCustomerMessageDeliveredAt!
    const deadline = deliveredAt.plus({ days: responseDays })
    const respondedAt = inquiry.firstVendorResponseAt
    const inTime = respondedAt !== null && respondedAt <= deadline
    if (respondedAt) {
      answered.push({ at: respondedAt, hours: respondedAt.diff(deliveredAt, 'hours').hours })
    }
    if (!inTime && deadline > now) {
      // Still inside its window with no answer - not counted either way yet.
      continue
    }
    counted++
    if (inTime) responded++
  }

  const recent = answered
    .sort((a, b) => b.at.toMillis() - a.at.toMillis())
    .slice(0, timeSampleSize)
    .map((entry) => Math.max(0, entry.hours))
  const medianHours = median(recent)
  return {
    responseRate: counted > 0 ? Math.round((responded / counted) * 100) : null,
    responseTimeHours: medianHours === null ? null : Math.round(medianHours * 10) / 10,
    counted,
  }
}

export async function recomputeResponseStats(vendorId: number, now = DateTime.now()) {
  const stats = await computeResponseStats(vendorId, now)
  await Vendor.query().where('id', vendorId).update({
    response_rate: stats.responseRate,
    response_time_hours: stats.responseTimeHours,
    response_stats_at: now.toSQL(),
  })
  return stats
}

/** Called when a vendor answers an inquiry (a reply or a decline). Best effort. */
export async function recomputeResponseStatsSafely(vendorId: number | null) {
  if (!vendorId) return
  try {
    await recomputeResponseStats(vendorId)
  } catch (error) {
    logger.error({ vendorId, error: String(error) }, 'Failed to recompute vendor response stats')
  }
}

/** Daily: every vendor with inquiries, plus any with stale cached stats. */
export async function recomputeAllResponseStats(now = DateTime.now()): Promise<number> {
  const withInquiries = await db
    .from('conversations')
    .where('kind', 'inquiry')
    .whereNotNull('vendor_id')
    .distinct('vendor_id')
  const cached = await Vendor.query().whereNotNull('responseStatsAt').select('id')
  const ids = new Set([
    ...withInquiries.map((row) => Number(row.vendor_id)),
    ...cached.map((vendor) => vendor.id),
  ])
  for (const vendorId of ids) {
    await recomputeResponseStats(vendorId, now)
  }
  return ids.size
}
