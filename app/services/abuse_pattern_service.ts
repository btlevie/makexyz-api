/**
 * The weekly pattern-discovery loop (docs/plans/messaging_moderation.md,
 * section 6 step 4): collect the violations moderators confirmed in the
 * period - especially the ones automation missed - and group them
 * deterministically so an engineer can see what new rule is needed:
 *
 * - domain: the same unlisted registrable domain in several of them;
 * - near_duplicate: nearly the same text (word-pair resemblance);
 * - phrase: word pairs common in the violations but rare in clean traffic;
 * - cohort: the same kind of sender (role, account age band, conversation kind);
 * - signals: the same combination of rules firing (shadow included).
 *
 * Optionally each cluster gets an LLM summary (pattern, proposed rule,
 * candidate phrases). The report is read-only output: it never changes a rule.
 */
import string from '@adonisjs/core/helpers/string'
import { DateTime } from 'luxon'
import env from '#start/env'
import Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'
import Customer from '#models/customer'
import Message from '#models/message'
import MessageUrl from '#models/message_url'
import ModerationCase from '#models/moderation_case'
import ModerationPatternReport from '#models/moderation_pattern_report'
import ModerationRuleHit from '#models/moderation_rule_hit'
import Vendor from '#models/vendor'
import { redact } from '#services/llm_moderation_service'
import {
  BedrockPatternSummarizer,
  FakePatternSummarizer,
  type PatternSummarizer,
} from '#services/moderation/llm/pattern_summarizer'
import { resemblance, shingles } from '#services/moderation/near_duplicate'
import { buildViews } from '#services/moderation/normalizer'
import { getEffectiveDomainLists, listStatusFor } from '#services/moderation/url/domain_registry'

export type ClusterKind = 'domain' | 'near_duplicate' | 'phrase' | 'cohort' | 'signals'

export interface PatternCluster {
  kind: ClusterKind
  key: string
  size: number
  /** How many of these automation missed (delivered before a person caught them). */
  missed: number
  categories: Record<string, number>
  messageUuids: string[]
  /** A few redacted snippets. */
  examples: string[]
}

export interface ClusterSummary {
  kind: ClusterKind
  key: string
  pattern: string
  proposedRule: string
  candidatePhrases: string[]
}

export const DISCOVERY_RULES = {
  minClusterSize: 2,
  minCohortSize: 3,
  nearDuplicateThreshold: 0.5,
  /** A phrase is distinctive when it's in this many violations... */
  phraseMinViolations: 2,
  /** ...and in at most this share of the clean baseline. */
  phraseMaxCleanRate: 0.002,
  cleanBaseline: 2000,
  maxClustersPerKind: 15,
  summarizeTop: 5,
}

export const fakePatternSummarizer = new FakePatternSummarizer()

function summarizer(): PatternSummarizer | null {
  if (env.get('NODE_ENV') === 'test') return fakePatternSummarizer
  return env.get('BEDROCK_REGION') ? new BedrockPatternSummarizer() : null
}

interface Violation {
  message: Message
  cases: ModerationCase[]
  missed: boolean
  category: string
  pairs: Set<string> | null
}

function wordPairs(text: string): Set<string> {
  const words = buildViews(text)
    .normalized.split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const pairs = new Set<string>()
  for (let i = 0; i + 1 < words.length; i++) pairs.add(`${words[i]} ${words[i + 1]}`)
  return pairs
}

function cluster(kind: ClusterKind, key: string, members: Violation[]): PatternCluster {
  const categories: Record<string, number> = {}
  for (const member of members) categories[member.category] = (categories[member.category] ?? 0) + 1
  return {
    kind,
    key,
    size: members.length,
    missed: members.filter((member) => member.missed).length,
    categories,
    messageUuids: members.map((member) => member.message.uuid).slice(0, 50),
    examples: members.slice(0, 3).map((member) => redact(member.message.body).slice(0, 400)),
  }
}

/** The confirmed violations whose cases were resolved in the window. */
async function violationsIn(start: DateTime, end: DateTime): Promise<Violation[]> {
  const cases = await ModerationCase.query()
    .whereNotNull('messageId')
    .where('status', 'resolved')
    .where('resolvedAt', '>', start.toSQL()!)
    .where('resolvedAt', '<=', end.toSQL()!)
  const confirmed = cases.filter(
    (moderationCase) =>
      moderationCase.resolution === 'blocked' ||
      moderationCase.resolution === 'removed' ||
      (Boolean(moderationCase.abuseCategory) && moderationCase.abuseCategory !== 'none')
  )
  const messages = await Message.query().whereIn(
    'id',
    confirmed.map((moderationCase) => moderationCase.messageId!)
  )
  return messages.map((message) => {
    const own = confirmed.filter((moderationCase) => moderationCase.messageId === message.id)
    return {
      message,
      cases: own,
      // Missed: labelled so, or it reached the recipient before a person caught it.
      missed:
        own.some((moderationCase) => moderationCase.missedByAutomation) ||
        message.deliveredAt !== null,
      category:
        own.find((moderationCase) => moderationCase.abuseCategory)?.abuseCategory ?? 'unlabelled',
      pairs: shingles(buildViews(message.body).normalized),
    }
  })
}

async function domainClusters(violations: Violation[]): Promise<PatternCluster[]> {
  const urls = await MessageUrl.query().whereIn(
    'messageId',
    violations.map((violation) => violation.message.id)
  )
  const lists = await getEffectiveDomainLists()
  const byDomain = new Map<string, Violation[]>()
  for (const url of urls) {
    if (!url.registrableDomain || listStatusFor(url.domain, lists).status !== 'none') continue
    const violation = violations.find((entry) => entry.message.id === url.messageId)!
    const members = byDomain.get(url.registrableDomain) ?? []
    if (!members.includes(violation)) members.push(violation)
    byDomain.set(url.registrableDomain, members)
  }
  return [...byDomain]
    .filter(([, members]) => members.length >= DISCOVERY_RULES.minClusterSize)
    .map(([domain, members]) => cluster('domain', domain, members))
}

/** Union-find over pairwise resemblance. */
function nearDuplicateClusters(violations: Violation[]): PatternCluster[] {
  const parent = violations.map((_, index) => index)
  const find = (index: number): number =>
    parent[index] === index ? index : (parent[index] = find(parent[index]))
  for (let i = 0; i < violations.length; i++) {
    for (let j = i + 1; j < violations.length; j++) {
      const a = violations[i].pairs
      const b = violations[j].pairs
      if (a && b && resemblance(a, b) >= DISCOVERY_RULES.nearDuplicateThreshold) {
        parent[find(i)] = find(j)
      }
    }
  }
  const groups = new Map<number, Violation[]>()
  violations.forEach((violation, index) => {
    const root = find(index)
    groups.set(root, [...(groups.get(root) ?? []), violation])
  })
  return [...groups.values()]
    .filter((members) => members.length >= DISCOVERY_RULES.minClusterSize)
    .map((members) =>
      cluster('near_duplicate', `${members[0].message.uuid} +${members.length - 1}`, members)
    )
}

/** Word pairs frequent in violations and rare in recent clean traffic. */
async function phraseClusters(violations: Violation[]): Promise<PatternCluster[]> {
  const clean = await Message.query()
    .where('status', 'delivered')
    .where('kind', 'text')
    .whereNotIn('id', (query) =>
      query.from('moderation_cases').whereNotNull('message_id').select('message_id')
    )
    .orderBy('id', 'desc')
    .limit(DISCOVERY_RULES.cleanBaseline)
    .select('body')
  const cleanCounts = new Map<string, number>()
  for (const row of clean) {
    for (const pair of wordPairs(row.body)) cleanCounts.set(pair, (cleanCounts.get(pair) ?? 0) + 1)
  }

  const byPair = new Map<string, Violation[]>()
  for (const violation of violations) {
    for (const pair of wordPairs(violation.message.body)) {
      byPair.set(pair, [...(byPair.get(pair) ?? []), violation])
    }
  }
  const maxClean = Math.max(1, Math.floor(clean.length * DISCOVERY_RULES.phraseMaxCleanRate))
  return [...byPair]
    .filter(
      ([pair, members]) =>
        members.length >= DISCOVERY_RULES.phraseMinViolations &&
        (cleanCounts.get(pair) ?? 0) <= maxClean
    )
    .sort((a, b) => b[1].length - a[1].length)
    .map(([pair, members]) => cluster('phrase', pair, members))
}

function ageBand(createdAt: DateTime | null, at: DateTime | null): string {
  if (!createdAt || !at) return 'unknown_age'
  const days = at.diff(createdAt, 'days').days
  return days < 7 ? 'under_7d' : days < 30 ? 'under_30d' : '30d_plus'
}

async function cohortClusters(violations: Violation[]): Promise<PatternCluster[]> {
  const participants = await ConversationParticipant.query().whereIn(
    'id',
    violations
      .map((violation) => violation.message.senderParticipantId)
      .filter((id): id is number => id !== null)
  )
  const conversations = await Conversation.query().whereIn(
    'id',
    violations.map((violation) => violation.message.conversationId)
  )
  const customers = await Customer.query().whereIn(
    'id',
    violations
      .map((violation) => violation.message.senderCustomerId)
      .filter((id): id is number => id !== null)
  )
  const vendors = await Vendor.query().whereIn(
    'id',
    violations
      .map((violation) => violation.message.senderVendorId)
      .filter((id): id is number => id !== null)
  )

  const byCohort = new Map<string, Violation[]>()
  for (const violation of violations) {
    const { message } = violation
    const role =
      participants.find((participant) => participant.id === message.senderParticipantId)?.role ??
      'system'
    const kind =
      conversations.find((conversation) => conversation.id === message.conversationId)?.kind ??
      'unknown'
    const account = message.senderCustomerId
      ? customers.find((customer) => customer.id === message.senderCustomerId)
      : vendors.find((vendor) => vendor.id === message.senderVendorId)
    const key = `${role}/${kind}/${ageBand(account?.createdAt ?? null, message.createdAt)}`
    byCohort.set(key, [...(byCohort.get(key) ?? []), violation])
  }
  return [...byCohort]
    .filter(([, members]) => members.length >= DISCOVERY_RULES.minCohortSize)
    .map(([key, members]) => cluster('cohort', key, members))
}

async function signalClusters(violations: Violation[]): Promise<PatternCluster[]> {
  const hits = await ModerationRuleHit.query().whereIn(
    'messageId',
    violations.map((violation) => violation.message.id)
  )
  const byCombo = new Map<string, Violation[]>()
  for (const violation of violations) {
    const rules = [
      ...new Set(
        hits.filter((hit) => hit.messageId === violation.message.id).map((hit) => hit.ruleId)
      ),
    ].sort()
    const key = rules.length > 0 ? rules.join(' + ') : '(no rule fired)'
    byCombo.set(key, [...(byCombo.get(key) ?? []), violation])
  }
  return [...byCombo]
    .filter(([, members]) => members.length >= DISCOVERY_RULES.minClusterSize)
    .map(([key, members]) => cluster('signals', key, members))
}

/** Runs the discovery over the `days` before `end` and stores the report. */
export async function discoverAbusePatterns(
  options: { end?: DateTime; days?: number; summarize?: boolean } = {}
): Promise<ModerationPatternReport> {
  const end = options.end ?? DateTime.now()
  const start = end.minus({ days: options.days ?? 7 })
  const violations = await violationsIn(start, end)

  const byKind = await Promise.all([
    domainClusters(violations),
    Promise.resolve(nearDuplicateClusters(violations)),
    phraseClusters(violations),
    cohortClusters(violations),
    signalClusters(violations),
  ])
  // Most-missed first within each kind - those are what new rules are for.
  const clusters = byKind.flatMap((list) =>
    list
      .sort((a, b) => b.missed - a.missed || b.size - a.size)
      .slice(0, DISCOVERY_RULES.maxClustersPerKind)
  )

  const summaries: ClusterSummary[] = []
  const client = options.summarize === false ? null : summarizer()
  if (client) {
    const top = [...clusters]
      .filter((entry) => entry.kind !== 'cohort')
      .sort((a, b) => b.missed - a.missed || b.size - a.size)
      .slice(0, DISCOVERY_RULES.summarizeTop)
    for (const entry of top) {
      const summary = await client.summarize({
        kind: entry.kind,
        key: entry.key,
        examples: entry.examples,
      })
      if (summary) {
        summaries.push({
          kind: entry.kind,
          key: entry.key,
          pattern: summary.pattern,
          proposedRule: summary.proposedRule,
          candidatePhrases: summary.candidatePhrases,
        })
      }
    }
  }

  return ModerationPatternReport.create({
    uuid: string.uuid(),
    periodStart: start,
    periodEnd: end,
    violations: violations.length,
    missedByAutomation: violations.filter((violation) => violation.missed).length,
    clusters,
    summaries,
  })
}
