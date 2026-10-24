/**
 * A sender's messaging trust tier and behavior counters
 * (docs/plans/messaging_moderation.md, section 5). Messaging only - these
 * never restrict quoting, checkout or fulfilment.
 *
 * Tiers:
 * - new: account under 7 days old, or fewer than 5 delivered messages.
 *   Lower risk-score thresholds.
 * - standard.
 * - trusted: 60+ days, 50+ delivered messages, no confirmed violations or
 *   reports in 30 days. Slightly relaxed thresholds; never bypasses blocks.
 * - restricted: everything goes to human review. Set by a moderator, or
 *   automatically after 2 confirmed violations (a moderator upheld a block)
 *   in 30 days - for 30 days.
 * - suspended: can't send (except where a live order needs it). Only ever a
 *   human decision.
 *
 * Separately, a temporary hold (`hold_until`) sends everything to review for
 * 24 hours after repeated blocked attempts, or when several vendors block the
 * same customer, and opens a behavioral case. It expires on its own.
 */
import string from '@adonisjs/core/helpers/string'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import ConversationBlock from '#models/conversation_block'
import Customer from '#models/customer'
import Message from '#models/message'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import ModerationCase from '#models/moderation_case'
import Vendor from '#models/vendor'
import { accountAgeDays } from '#services/behavior_signal_service'
import { recordModerationAction } from '#services/moderation_action_service'

export type TrustTier = MessagingRiskProfile['trustTier']

export interface RiskPrincipal {
  customerId?: number | null
  vendorId?: number | null
}

export const TIER_RULES = {
  newAccountDays: 7,
  newDeliveredMessages: 5,
  trustedAccountDays: 60,
  trustedDeliveredMessages: 50,
  /** Confirmed violations in 30 days that restrict automatically. */
  autoRestrictViolations: 2,
  autoRestrictDays: 30,
}

export const HOLD_RULES = {
  /** More than this many blocked messages in an hour holds the sender. */
  blockedPerHour: 3,
  /** Distinct vendors blocking a customer within 30 days that holds them. */
  vendorBlocks: 2,
  hours: 24,
}

const BEHAVIORAL_CASE_PRIORITY = 25

function profileQuery(principal: RiskPrincipal, client?: any) {
  const query = MessagingRiskProfile.query(client ? { client } : {})
  return principal.customerId
    ? query.where('customerId', principal.customerId)
    : query.where('vendorId', principal.vendorId!)
}

function hasPrincipal(principal: RiskPrincipal) {
  return Boolean(principal.customerId || principal.vendorId)
}

/** The principal half of a message's sender, as the risk profile keys it. */
export function principalOf(message: Pick<Message, 'senderCustomerId' | 'senderVendorId'>) {
  return message.senderCustomerId
    ? { customerId: message.senderCustomerId }
    : { vendorId: message.senderVendorId }
}

/**
 * The tier in force right now. No profile yet means 'new'. A restriction
 * past its expiry no longer applies; an active temporary hold counts as
 * 'restricted' (everything to review) without changing the stored tier.
 */
export async function effectiveTrustTier(principal: RiskPrincipal): Promise<TrustTier> {
  if (!hasPrincipal(principal)) {
    return 'standard'
  }
  const profile = await profileQuery(principal).first()
  if (!profile) {
    return 'new'
  }

  const now = DateTime.now()
  const restricted = profile.trustTier === 'restricted' || profile.trustTier === 'suspended'
  const expired = restricted && profile.restrictionExpiresAt && profile.restrictionExpiresAt <= now
  if (profile.holdUntil && profile.holdUntil > now && profile.trustTier !== 'suspended') {
    return 'restricted'
  }
  return expired ? 'standard' : profile.trustTier
}

/** Opens a behavioral case unless an unresolved one with the same key exists. */
export async function openBehavioralCase(input: {
  principal: RiskPrincipal | null
  dedupKey: string
  note: string
  details: Record<string, unknown>
  messageId?: number | null
  priority?: number
}): Promise<ModerationCase | null> {
  const existing = await ModerationCase.query()
    .where('dedupKey', input.dedupKey)
    .whereNot('status', 'resolved')
    .first()
  if (existing) {
    return null
  }
  return ModerationCase.create({
    uuid: string.uuid(),
    messageId: input.messageId ?? null,
    customerId: input.principal?.customerId ?? null,
    vendorId: input.principal?.vendorId ?? null,
    source: 'behavioral',
    priority: input.priority ?? BEHAVIORAL_CASE_PRIORITY,
    status: 'open',
    patternNote: input.note,
    details: input.details,
    dedupKey: input.dedupKey,
    missedByAutomation: false,
  })
}

/** Puts a temporary hold on a sender (everything to review) and records why. */
async function applyHold(principal: RiskPrincipal, reason: string) {
  const until = DateTime.now().plus({ hours: HOLD_RULES.hours })
  await MessagingRiskProfile.updateOrCreate(
    principal.customerId ? { customerId: principal.customerId } : { vendorId: principal.vendorId! },
    { holdUntil: until, holdReason: reason }
  )
  return until
}

function principalKey(principal: RiskPrincipal) {
  return principal.customerId ? `customer:${principal.customerId}` : `vendor:${principal.vendorId}`
}

/**
 * After a blocked message: more than HOLD_RULES.blockedPerHour blocks in an
 * hour is someone probing for what gets through. Their messages go to
 * review for 24 hours and a case shows a moderator the blocked attempts.
 * Best-effort - never fails the send it follows.
 */
export async function noteBlockedAttempt(message: Message) {
  const principal = principalOf(message)
  if (!hasPrincipal(principal)) return
  try {
    const since = DateTime.now().minus({ hours: 1 }).toSQL()!
    const blocked = await Message.query()
      .if(principal.customerId, (query) => query.where('senderCustomerId', principal.customerId!))
      .if(!principal.customerId, (query) => query.where('senderVendorId', principal.vendorId!))
      .where('status', 'blocked')
      .where('createdAt', '>', since)
      .orderBy('id', 'asc')
      .select('id', 'uuid', 'blockReasonCode')
    if (blocked.length <= HOLD_RULES.blockedPerHour) return

    const profile = await profileQuery(principal).first()
    if (profile?.holdUntil && profile.holdUntil > DateTime.now()) return

    const until = await applyHold(principal, 'repeated_blocks')
    await openBehavioralCase({
      principal,
      dedupKey: `hold:blocks:${principalKey(principal)}`,
      messageId: message.id,
      note: `${blocked.length} blocked messages in an hour - held for review until ${until.toISO()}`,
      details: {
        kind: 'repeated_blocks',
        holdUntil: until.toISO(),
        blockedMessages: blocked.map((row) => ({ uuid: row.uuid, reason: row.blockReasonCode })),
      },
    })
  } catch (error) {
    logger.error({ error: String(error) }, 'Failed to evaluate repeated blocked attempts')
  }
}

/**
 * After a vendor blocks a customer: several vendors blocking the same
 * customer within 30 days holds their messages for review and opens a case.
 */
export async function noteVendorBlock(customerId: number) {
  try {
    const since = DateTime.now().minus({ days: 30 }).toSQL()!
    const blocks = await ConversationBlock.query()
      .where('customerId', customerId)
      .where('createdAt', '>', since)
    const vendors = new Set(blocks.map((block) => block.vendorId))
    await MessagingRiskProfile.updateOrCreate({ customerId }, { vendorBlocks: vendors.size })
    if (vendors.size < HOLD_RULES.vendorBlocks) return

    const until = await applyHold({ customerId }, 'vendor_blocks')
    await openBehavioralCase({
      principal: { customerId },
      dedupKey: `hold:vendor_blocks:customer:${customerId}`,
      note: `Blocked by ${vendors.size} vendors in 30 days - held for review until ${until.toISO()}`,
      details: {
        kind: 'vendor_blocks',
        holdUntil: until.toISO(),
        blocks: blocks.map((block) => ({
          vendorId: block.vendorId,
          reason: block.reason,
          at: block.createdAt?.toISO() ?? null,
        })),
      },
    })
  } catch (error) {
    logger.error({ customerId, error: String(error) }, 'Failed to evaluate vendor blocks')
  }
}

interface Counters {
  deliveredMessages: number
  confirmedViolations: number
  latestConfirmedAt: DateTime | null
  reportsReceived: number
  vendorBlocks: number
}

async function countersFor(principal: RiskPrincipal, now: DateTime): Promise<Counters> {
  const since = now.minus({ days: 30 }).toSQL()!
  const senderColumn = principal.customerId ? 'sender_customer_id' : 'sender_vendor_id'
  const senderId = principal.customerId ?? principal.vendorId!

  const delivered = await db
    .from('messages')
    .where(senderColumn, senderId)
    .whereIn('status', ['delivered', 'delivered_flagged'])
    .count('* as total')
    .first()
  // A moderator blocking/removing the message is what "confirmed" means -
  // automatic blocks never count toward restriction.
  const confirmed = await db
    .from('messages')
    .where(senderColumn, senderId)
    .where('block_reason_code', 'moderator')
    .where('updated_at', '>', since)
    .select('updated_at')
    .orderBy('updated_at', 'desc')
  const reports = await db
    .from('message_reports')
    .join('messages', 'messages.id', 'message_reports.message_id')
    .where(`messages.${senderColumn}`, senderId)
    .where('message_reports.created_at', '>', since)
    .count('* as total')
    .first()
  const vendorBlocks = principal.customerId
    ? await db
        .from('conversation_blocks')
        .where('customer_id', principal.customerId)
        .where('created_at', '>', since)
        .countDistinct('vendor_id as total')
        .first()
    : null

  const latest = confirmed[0]?.updated_at
  return {
    deliveredMessages: Number(delivered?.total ?? 0),
    confirmedViolations: confirmed.length,
    latestConfirmedAt: latest
      ? latest instanceof Date
        ? DateTime.fromJSDate(latest)
        : DateTime.fromSQL(String(latest), { zone: 'utc' })
      : null,
    reportsReceived: Number(reports?.total ?? 0),
    vendorBlocks: Number(vendorBlocks?.total ?? 0),
  }
}

/** The automatic tier from age and history - new, standard or trusted. */
export function automaticTier(age: number | null, counters: Counters): TrustTier {
  if (
    age === null ||
    age < TIER_RULES.newAccountDays ||
    counters.deliveredMessages < TIER_RULES.newDeliveredMessages
  ) {
    return 'new'
  }
  if (
    age >= TIER_RULES.trustedAccountDays &&
    counters.deliveredMessages >= TIER_RULES.trustedDeliveredMessages &&
    counters.confirmedViolations === 0 &&
    counters.reportsReceived === 0
  ) {
    return 'trusted'
  }
  return 'standard'
}

/** Hourly message counts over the last 7 days (excluding the current hour), and this hour's. */
async function hourlyVolume(principal: RiskPrincipal, now: DateTime) {
  const currentHour = now.startOf('hour')
  const rows = await Message.query()
    .if(principal.customerId, (query) => query.where('senderCustomerId', principal.customerId!))
    .if(!principal.customerId, (query) => query.where('senderVendorId', principal.vendorId!))
    .where('createdAt', '>', currentHour.minus({ days: 7 }).toSQL()!)
    .select('createdAt')

  const buckets = new Array<number>(7 * 24).fill(0)
  let current = 0
  for (const row of rows) {
    if (!row.createdAt) continue
    if (row.createdAt >= currentHour) {
      current++
      continue
    }
    const index = Math.floor(currentHour.diff(row.createdAt.startOf('hour'), 'hours').hours) - 1
    if (index >= 0 && index < buckets.length) buckets[index]++
  }
  const mean = buckets.reduce((sum, count) => sum + count, 0) / buckets.length
  const variance = buckets.reduce((sum, count) => sum + (count - mean) ** 2, 0) / buckets.length
  return { mean, stddev: Math.sqrt(variance), current }
}

/** A sender this hour sending far beyond their own baseline (z-score) - a hijacked account or a campaign. */
export const ANOMALY_RULES = { zScore: 4, minMessages: 20 }

/**
 * Recomputes a sender's counters, baseline and automatic tier. Runs hourly
 * (RecomputeRiskProfiles) and right after a moderator's decision about them.
 * Manual restrictions and suspensions are left alone until they expire.
 */
export async function refreshRiskProfile(
  principal: RiskPrincipal,
  now = DateTime.now()
): Promise<MessagingRiskProfile | null> {
  if (!hasPrincipal(principal)) return null
  const [counters, age, volume] = await Promise.all([
    countersFor(principal, now),
    accountAgeDays(
      { customerId: principal.customerId ?? null, vendorId: principal.vendorId ?? null },
      now
    ),
    hourlyVolume(principal, now),
  ])

  const profile =
    (await profileQuery(principal).first()) ??
    new MessagingRiskProfile().merge(
      principal.customerId
        ? { customerId: principal.customerId }
        : { vendorId: principal.vendorId! }
    )
  const previousTier = profile.$isPersisted ? profile.trustTier : null

  const restriction = profile.trustTier === 'restricted' || profile.trustTier === 'suspended'
  const restrictionActive =
    restriction && (!profile.restrictionExpiresAt || profile.restrictionExpiresAt > now)
  const newViolationSinceLastAuto =
    counters.latestConfirmedAt &&
    (!profile.autoRestrictedAt || counters.latestConfirmedAt > profile.autoRestrictedAt)

  let autoRestricted = false
  if (restrictionActive) {
    // A moderator's (or an earlier automatic) restriction stays until it expires.
  } else if (
    counters.confirmedViolations >= TIER_RULES.autoRestrictViolations &&
    newViolationSinceLastAuto
  ) {
    profile.merge({
      trustTier: 'restricted',
      tierSource: 'auto',
      restrictionExpiresAt: now.plus({ days: TIER_RULES.autoRestrictDays }),
      autoRestrictedAt: now,
    })
    autoRestricted = true
  } else {
    profile.merge({
      trustTier: automaticTier(age, counters),
      tierSource: 'auto',
      restrictionExpiresAt: null,
    })
  }

  profile.merge({
    deliveredMessages: counters.deliveredMessages,
    confirmedViolations: counters.confirmedViolations,
    reportsReceived: counters.reportsReceived,
    vendorBlocks: counters.vendorBlocks,
    hourlyMean: volume.mean,
    hourlyStddev: volume.stddev,
    computedAt: now,
  })
  if (profile.holdUntil && profile.holdUntil <= now) {
    profile.merge({ holdUntil: null, holdReason: null })
  }
  await profile.save()

  if (autoRestricted) {
    const subject = principal.customerId
      ? await Customer.find(principal.customerId)
      : await Vendor.find(principal.vendorId!)
    await recordModerationAction({
      actorUserId: null,
      action: 'restrict_user',
      targetType: principal.customerId ? 'customer' : 'vendor',
      targetId: subject?.uuid ?? principalKey(principal),
      reason: `${counters.confirmedViolations} confirmed violations in 30 days`,
      metadata: {
        automatic: true,
        previousTier,
        expiresAt: profile.restrictionExpiresAt?.toISO() ?? null,
      },
    })
  }

  const z = (volume.current - volume.mean) / Math.max(volume.stddev, 1)
  if (volume.current >= ANOMALY_RULES.minMessages && z >= ANOMALY_RULES.zScore) {
    await openBehavioralCase({
      principal,
      dedupKey: `volume:${principalKey(principal)}:${now.toFormat('yyyy-LL-dd-HH')}`,
      note: `${volume.current} messages this hour against a baseline of ${volume.mean.toFixed(1)}/hour`,
      details: {
        kind: 'volume_anomaly',
        currentHour: volume.current,
        hourlyMean: volume.mean,
        hourlyStddev: volume.stddev,
        zScore: Number(z.toFixed(2)),
      },
    })
  }
  return profile
}

/**
 * The RecomputeRiskProfiles job: every sender active in the last 7 days, plus
 * everyone with a restriction or hold that might have expired.
 */
export async function recomputeRiskProfiles(now = DateTime.now()) {
  const since = now.minus({ days: 7 }).toSQL()!
  const senders: { sender_customer_id: number | null; sender_vendor_id: number | null }[] = await db
    .from('messages')
    .where('created_at', '>', since)
    .whereNotNull('sender_participant_id')
    .distinct('sender_customer_id', 'sender_vendor_id')
  const flagged = await MessagingRiskProfile.query()
    .whereIn('trustTier', ['restricted', 'suspended'])
    .orWhereNotNull('holdUntil')

  const principals = new Map<string, RiskPrincipal>()
  for (const row of senders) {
    const principal = row.sender_customer_id
      ? { customerId: row.sender_customer_id }
      : row.sender_vendor_id
        ? { vendorId: row.sender_vendor_id }
        : null
    if (principal) principals.set(principalKey(principal), principal)
  }
  for (const profile of flagged) {
    const principal = profile.customerId
      ? { customerId: profile.customerId }
      : { vendorId: profile.vendorId }
    principals.set(principalKey(principal), principal)
  }

  let refreshed = 0
  for (const principal of principals.values()) {
    try {
      await refreshRiskProfile(principal, now)
      refreshed++
    } catch (error) {
      logger.error({ principal, error: String(error) }, 'Failed to refresh a risk profile')
    }
  }
  return refreshed
}
