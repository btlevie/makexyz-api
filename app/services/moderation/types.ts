import type { ProhibitedCategory } from '#services/moderation/prohibited_terms'
import type { DomainListStatus } from '#services/moderation/url/domain_lists'
import type { UrlFlag } from '#services/moderation/url/static_checks'
import type { TrustTier } from '#services/messaging_risk_service'

/**
 * Shared types for the message moderation pipeline. See
 * docs/plans/messaging_moderation.md (sections 2-3) for the design: extractors
 * turn text into signals, small independent rules turn signals + context into
 * explicit decisions, and a combiner picks the outcome.
 */

/**
 * What the pipeline decided for a message, strongest last. `hold` waits for
 * automated analysis (link reputation, attachment scans) before deciding.
 */
export type Decision = 'allow' | 'flag' | 'escalate' | 'review' | 'hold' | 'block'

/**
 * What a single rule asks for. `continue` contributes weight to the risk
 * score only; `hold` waits for the async analysis (AnalyzeMessage) and the
 * message is judged again with its results; `allow_override` and `redact`
 * are reserved for later rules.
 */
export type RuleAction =
  | 'block'
  | 'hold'
  | 'review'
  | 'escalate'
  | 'flag'
  | 'allow_override'
  | 'continue'
  | 'redact'

export type RuleMode = 'off' | 'shadow' | 'enforce'

export type SenderRole = 'customer' | 'vendor' | 'staff'

export type Channel = 'web' | 'email'

export type ConversationKind = 'inquiry' | 'order' | 'support'

/**
 * The same text seen several ways, so an obfuscated contact detail shows up
 * in a later view even though it isn't in `raw`:
 * - `normalized`: NFKC, invisible characters stripped, lowercased.
 * - `deobfuscated`: bracketed tricks undone - `[.]`, `(dot)`, `[at]`, `hxxp`.
 * - `deobfuscatedLoose`: also a bare " at " before a domain ("jo at gmail dot
 *   com"). Looser, so matches found only here are treated as less certain.
 */
export interface TextViews {
  raw: string
  normalized: string
  deobfuscated: string
  deobfuscatedLoose: string
  /**
   * For word-list matching only: leetspeak undone ("d1sc0rd" -> "discord")
   * and spaced-out letters joined ("t e l e g r a m"). Real digits are gone.
   */
  compact: string
  /** Number words as digits ("five five five") with separators between digit groups removed. */
  numeric: string
}

export type ViewName = keyof TextViews

/** A matched span, shown to moderators so they see exactly what fired. */
export interface Evidence {
  view: ViewName
  match: string
  /** Prohibited-item terms: which list entry matched (built-in, or an admin row's uuid). */
  termSource?: 'builtin' | 'admin'
  termUuid?: string | null
  /** A shadow term - recorded, never acted on. */
  termStatus?: 'shadow'
}

export interface ExtractedEmail {
  address: string
  /** The strictest view it appeared in. */
  view: ViewName
}

export interface ExtractedPhone {
  /** E.164, e.g. +14155550123. */
  number: string
  match: string
}

/** A url_scans row as the rules see it - the async analysis of one link. */
export interface UrlScanSummary {
  verdict: 'safe' | 'malicious' | 'unknown'
  threatTypes: string[]
  /** Where redirects ended, when they went somewhere else. */
  finalHostname: string | null
  /** The final host's list (a shortener to Drive is user content). */
  finalList: DomainListStatus | null
  /** From RDAP, for the final domain; null when unknown or allow-listed. */
  domainAgeDays: number | null
  /** Why: 'web_risk', 'redirect_private_ip', 'web_risk_unavailable'... */
  reasons: string[]
}

export interface ExtractedUrl {
  /** As written in the text. */
  match: string
  /** Normalized (see url/normalize.ts) - what's looked up and linked to. */
  url: string
  /** sha256 of `url` - the url_scans key. */
  hash: string
  hostname: string
  /** eTLD+1 (e.g. example.co.uk), or null for IPs/unknown suffixes. */
  registrableDomain: string | null
  /** The effective domain list the host is on (url/domain_registry.ts). */
  list: DomainListStatus
  /** Shorthand for list === 'allow'. */
  allowlisted: boolean
  /** Shape checks (url/static_checks.ts) - no network involved. */
  flags: UrlFlag[]
  /** In the message text, or decoded from an attachment (QR code, PDF link). */
  source: 'text' | 'attachment'
  /** The cached async analysis, if there's a fresh one. Null = not analysed yet. */
  scan: UrlScanSummary | null
}

/** `@name` - a social handle shape (never part of an email address). */
export interface ExtractedHandle {
  handle: string
}

export interface ExtractedCryptoAddress {
  kind: 'btc' | 'eth' | 'tron'
  address: string
}

export interface ExtractedBankDetail {
  kind: 'iban' | 'routing_number' | 'swift_bic'
  value: string
}

/** A 10-15 digit run that isn't a valid phone number, an order number or a dimension. */
export interface ExtractedDigitRun {
  digits: string
}

export interface ProfanitySignal {
  /** How many profane terms (the obscenity library's English dataset). */
  count: number
  /** Whether one sits within a few words of "you"/"your" - aimed at the reader. */
  directed: boolean
  terms: string[]
}

/** A file sent with the message, as far as its checks have got. */
export interface AttachmentSignal {
  uuid: string
  fileName: string
  extname: string
  status: 'pending_upload' | 'uploaded' | 'clean' | 'rejected' | 'review'
  rejectReason: string | null
}

/** Everything the extractors found - persisted on the evaluation. */
export interface Signals {
  emails: ExtractedEmail[]
  phones: ExtractedPhone[]
  urls: ExtractedUrl[]
  handles: ExtractedHandle[]
  cryptoAddresses: ExtractedCryptoAddress[]
  bankDetails: ExtractedBankDetail[]
  digitRuns: ExtractedDigitRun[]
  profanity: ProfanitySignal
  attachments: AttachmentSignal[]
}

/**
 * Where the message is going. Rules use it for direction- and phase-aware
 * thresholds (vendor -> customer is the strictest direction).
 */
export interface ConversationContext {
  kind: ConversationKind
  /** The first message of an inquiry - the cold-pitch and duplicate-RFQ rules care. */
  isFirstMessage: boolean
  /** The order's status for order threads (and inquiries that became orders), else null. */
  orderStatus: string | null
}

/**
 * Behavioral facts looked up before the rules run (rules themselves never do
 * I/O). Counted over the last 24 hours, excluding the current conversation.
 */
export interface HistoryLookups {
  /** Other conversations this sender sent the exact same (normalized) text to. */
  sameTextOtherConversations: number
  /** Distinct other senders who sent the exact same text. */
  sameTextOtherSenders: number
  /** Other conversations this sender sent nearly the same text to (last 7 days, near_duplicate.ts). */
  nearDuplicateOtherConversations: number
  /** The sender's messages (any status) in the last hour / day. */
  messagesLastHour: number
  messagesLastDay: number
  /** Distinct conversations the sender posted in over the last day. */
  conversationsLastDay: number
  /** Customers: distinct vendors they've messaged in inquiries over the last 7 days. */
  vendorsContactedWeek: number
  /** The sender's messages blocked in the last hour - probing for what gets through. */
  blockedLastHour: number
  /** Registrable domain of each link -> how many other senders linked to it in the last day. */
  domainSenders: Record<string, number>
  /** From the sender's risk profile (messaging_risk_service.ts), recomputed hourly. */
  accountAgeDays: number | null
  deliveredMessages: number
  reportsReceived30d: number
  /** Customers: distinct vendors who blocked them in the last 30 days. */
  vendorBlocks30d: number
  confirmedViolations30d: number
}

/** What the behavioral lookups are keyed by, computed by the pipeline. */
export interface HistoryKeys {
  contentHash: string
  normalized: string
  /** Registrable domains of the message's links. */
  domains: string[]
}

export interface RuleContext {
  views: TextViews
  signals: Signals
  senderRole: SenderRole
  channel: Channel
  conversation: ConversationContext
  history: HistoryLookups
  /** The sender's messaging trust tier (messaging_risk_service.ts). */
  trustTier: TrustTier
}

export interface RuleResult {
  action: RuleAction
  /** Stable machine code, stored on the message when this rule decides it. */
  reasonCode: string
  /** Risk-score contribution (only meaningful for `continue`). */
  weight?: number
  evidence: Evidence[]
  /**
   * Shown to the sender when this rule blocks their message. Omit for
   * spam/scam/malicious-link rules - naming them helps people probe them.
   */
  userMessage?: string
  /** Open a moderation case when this result blocks the message (e.g. prohibited items). */
  caseSource?: 'prohibited_item'
}

/**
 * A moderation rule. Rules are pure: everything they need arrives in the
 * context, so they're trivially unit-tested and can be replayed over stored
 * signals. Adding a rule means a new file plus one line in rules/index.ts.
 */
export interface ModerationRule<C extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable slug, e.g. 'contact.email'. Never reused for different logic. */
  id: string
  /** Bumped whenever the rule's logic changes; recorded with every hit. */
  version: number
  description: string
  /** Mode used when no moderation_rule_configs row overrides it. */
  defaultMode: RuleMode
  defaultConfig: C
  /** Limit the rule to certain senders; omitted means everyone but staff. */
  senderRoles?: SenderRole[]
  /**
   * Set on the prohibited-item rules: the rule registry injects this
   * category's effective (built-in + admin) terms into the rule's config.
   */
  termCategory?: ProhibitedCategory
  evaluate(ctx: RuleContext, config: C): RuleResult | null
}
