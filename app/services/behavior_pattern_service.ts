/**
 * The daily, cross-account side of behavioral detection
 * (docs/plans/messaging_moderation.md, sections 5-6). Nothing here decides a
 * message - each detector opens a behavioral case for a person, at most one
 * open case per pattern (moderation_cases.dedup_key).
 *
 * - Shared-domain clusters: several new accounts linking the same unlisted
 *   domain within a week - one operator behind many accounts.
 * - Report-rate outliers: vendors reported far more often than their peers,
 *   per message delivered.
 * - Audit sample: a random slice of delivered messages nobody flagged, so
 *   moderators can find what the rules miss.
 */
import string from '@adonisjs/core/helpers/string'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Customer from '#models/customer'
import Message from '#models/message'
import ModerationCase from '#models/moderation_case'
import Vendor from '#models/vendor'
import { openBehavioralCase, TIER_RULES } from '#services/messaging_risk_service'
import { getEffectiveDomainLists, listStatusFor } from '#services/moderation/url/domain_registry'

export const PATTERN_RULES = {
  clusterWindowDays: 7,
  /** New accounts linking the same unlisted domain that make a cluster. */
  clusterAccounts: 3,
  reportWindowDays: 30,
  /** A vendor needs at least this many reports... */
  outlierMinReports: 3,
  /** ...and a report rate this many times the median vendor's. */
  outlierMedianMultiple: 3,
  /** Share of yesterday's delivered, unflagged messages put in the audit sample. */
  auditRate: 0.01,
  auditMax: 20,
  auditMin: 1,
  /** Share of yesterday's automatic blocks re-checked by a person. */
  blockedAuditRate: 0.05,
  blockedAuditMax: 10,
}

const AUDIT_PRIORITY = 90

type SenderRow = {
  registrable_domain: string
  hostname: string
  sender_customer_id: number | null
  sender_vendor_id: number | null
  message_uuid: string
}

/** Accounts created within TIER_RULES.newAccountDays, keyed 'customer:1' / 'vendor:2'. */
async function newAccounts(rows: SenderRow[], now: DateTime): Promise<Map<string, string>> {
  const cutoff = now.minus({ days: TIER_RULES.newAccountDays })
  const customerIds = [...new Set(rows.map((row) => row.sender_customer_id).filter(Boolean))]
  const vendorIds = [...new Set(rows.map((row) => row.sender_vendor_id).filter(Boolean))]
  const young = new Map<string, string>()
  for (const customer of await Customer.query().whereIn('id', customerIds as number[])) {
    if (customer.createdAt && customer.createdAt > cutoff)
      young.set(`customer:${customer.id}`, customer.uuid)
  }
  for (const vendor of await Vendor.query().whereIn('id', vendorIds as number[])) {
    if (vendor.createdAt && vendor.createdAt > cutoff) young.set(`vendor:${vendor.id}`, vendor.uuid)
  }
  return young
}

/** New accounts converging on the same unlisted domain. */
export async function detectSharedDomainClusters(now = DateTime.now()): Promise<number> {
  const rows: SenderRow[] = await db
    .from('message_urls')
    .join('messages', 'messages.id', 'message_urls.message_id')
    .whereNotNull('message_urls.registrable_domain')
    .whereNotNull('messages.sender_participant_id')
    .where(
      'message_urls.created_at',
      '>',
      now.minus({ days: PATTERN_RULES.clusterWindowDays }).toSQL()!
    )
    .select(
      'message_urls.registrable_domain',
      'message_urls.domain as hostname',
      'messages.sender_customer_id',
      'messages.sender_vendor_id',
      'messages.uuid as message_uuid'
    )
  if (rows.length === 0) return 0

  const lists = await getEffectiveDomainLists()
  const young = await newAccounts(rows, now)
  const byDomain = new Map<string, { accounts: Set<string>; messages: Set<string> }>()
  for (const row of rows) {
    // By host: drive.google.com is user content even though google.com is on no list.
    if (listStatusFor(row.hostname, lists).status !== 'none') continue
    const key = row.sender_customer_id
      ? `customer:${row.sender_customer_id}`
      : `vendor:${row.sender_vendor_id}`
    if (!young.has(key)) continue
    const entry = byDomain.get(row.registrable_domain) ?? {
      accounts: new Set(),
      messages: new Set(),
    }
    entry.accounts.add(key)
    entry.messages.add(row.message_uuid)
    byDomain.set(row.registrable_domain, entry)
  }

  let opened = 0
  for (const [domain, { accounts, messages }] of byDomain) {
    if (accounts.size < PATTERN_RULES.clusterAccounts) continue
    const created = await openBehavioralCase({
      principal: null,
      dedupKey: `cluster:domain:${domain}`,
      note: `${accounts.size} new accounts linked ${domain} within ${PATTERN_RULES.clusterWindowDays} days`,
      details: {
        kind: 'shared_domain_cluster',
        domain,
        accounts: [...accounts].map((key) => ({ type: key.split(':')[0], uuid: young.get(key) })),
        messageUuids: [...messages].slice(0, 50),
      },
    })
    if (created) opened++
  }
  return opened
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Vendors reported far more often per delivered message than the median vendor. */
export async function detectReportRateOutliers(now = DateTime.now()): Promise<number> {
  const since = now.minus({ days: PATTERN_RULES.reportWindowDays }).toSQL()!
  const delivered: { sender_vendor_id: number; total: number | string }[] = await db
    .from('messages')
    .whereNotNull('sender_vendor_id')
    .whereIn('status', ['delivered', 'delivered_flagged', 'removed'])
    .where('created_at', '>', since)
    .groupBy('sender_vendor_id')
    .select('sender_vendor_id')
    .count('* as total')
  const reports: { sender_vendor_id: number; total: number | string }[] = await db
    .from('message_reports')
    .join('messages', 'messages.id', 'message_reports.message_id')
    .whereNotNull('messages.sender_vendor_id')
    .where('message_reports.created_at', '>', since)
    .groupBy('messages.sender_vendor_id')
    .select('messages.sender_vendor_id')
    .count('* as total')

  const reportsBy = new Map(reports.map((row) => [row.sender_vendor_id, Number(row.total)]))
  const rates = delivered.map((row) => ({
    vendorId: row.sender_vendor_id,
    delivered: Number(row.total),
    reports: reportsBy.get(row.sender_vendor_id) ?? 0,
  }))

  let opened = 0
  for (const rate of rates) {
    const ratio = rate.reports / rate.delivered
    if (rate.reports < PATTERN_RULES.outlierMinReports) continue
    // Against the other vendors - with none, or most never reported (median 0),
    // enough reports is itself the outlier.
    const typical = median(
      rates.filter((other) => other !== rate).map((other) => other.reports / other.delivered)
    )
    if (typical > 0 && ratio < typical * PATTERN_RULES.outlierMedianMultiple) continue
    const created = await openBehavioralCase({
      principal: { vendorId: rate.vendorId },
      dedupKey: `report_rate:vendor:${rate.vendorId}`,
      note: `${rate.reports} reports on ${rate.delivered} delivered messages in ${PATTERN_RULES.reportWindowDays} days`,
      details: {
        kind: 'report_rate_outlier',
        reports: rate.reports,
        delivered: rate.delivered,
        rate: Number(ratio.toFixed(4)),
        medianRate: Number(typical.toFixed(4)),
      },
    })
    if (created) opened++
  }
  return opened
}

/** Picks `rate` of the candidates (within min/max) at random and queues them for audit. */
async function sample(candidates: Message[], rate: number, max: number): Promise<number> {
  if (candidates.length === 0) return 0
  const size = Math.min(max, Math.max(PATTERN_RULES.auditMin, Math.round(candidates.length * rate)))
  const picked = [...candidates].sort(() => Math.random() - 0.5).slice(0, size)
  await ModerationCase.createMany(
    picked.map((message) => ({
      uuid: string.uuid(),
      messageId: message.id,
      customerId: message.senderCustomerId,
      vendorId: message.senderVendorId,
      source: 'audit_sample' as const,
      priority: AUDIT_PRIORITY,
      status: 'open' as const,
      missedByAutomation: false,
    }))
  )
  return picked.length
}

/**
 * A random slice of yesterday's traffic nobody else looked at, queued at low
 * priority (section 6 "Labels"):
 * - delivered, unflagged messages - how moderators find what the rules let
 *   through (the false-negative rate);
 * - automatic blocks - approving one marks the block overturned, which is
 *   how each rule's false-positive rate is measured (rule_stats_service.ts).
 *   Approving an audited block doesn't deliver it.
 */
export async function sampleAuditMessages(now = DateTime.now()): Promise<number> {
  const since = now.minus({ hours: 24 }).toSQL()!
  const uncased = (query: any) =>
    query.whereNotIn('id', (sub: any) =>
      sub.from('moderation_cases').whereNotNull('message_id').select('message_id')
    )
  const delivered = await uncased(
    Message.query()
      .where('status', 'delivered')
      .where('kind', 'text')
      .whereNotNull('senderParticipantId')
      .where('createdAt', '>', since)
  ).select('id', 'senderCustomerId', 'senderVendorId')
  const blocked = await uncased(
    Message.query()
      .where('status', 'blocked')
      .whereNot('blockReasonCode', 'moderator')
      .whereNotNull('senderParticipantId')
      .where('createdAt', '>', since)
  ).select('id', 'senderCustomerId', 'senderVendorId')

  return (
    (await sample(delivered, PATTERN_RULES.auditRate, PATTERN_RULES.auditMax)) +
    (await sample(blocked, PATTERN_RULES.blockedAuditRate, PATTERN_RULES.blockedAuditMax))
  )
}
