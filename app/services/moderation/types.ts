/**
 * Shared types for the message moderation pipeline. See
 * docs/plans/messaging_moderation.md (sections 2-3) for the design: extractors
 * turn text into signals, small independent rules turn signals + context into
 * explicit decisions, and a combiner picks the outcome.
 */

/** What the pipeline decided for a message, strongest last. */
export type Decision = 'allow' | 'flag' | 'escalate' | 'review' | 'block'

/**
 * What a single rule asks for. `continue` contributes weight to the risk
 * score only; `allow_override` and `redact` are reserved for later rules.
 */
export type RuleAction =
  | 'block'
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
}

export type ViewName = keyof TextViews

/** A matched span, shown to moderators so they see exactly what fired. */
export interface Evidence {
  view: ViewName
  match: string
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

export interface ExtractedUrl {
  match: string
  hostname: string
  /** eTLD+1 (e.g. example.co.uk), or null for IPs/unknown suffixes. */
  registrableDomain: string | null
  allowlisted: boolean
}

/** Everything the extractors found - persisted on the evaluation. */
export interface Signals {
  emails: ExtractedEmail[]
  phones: ExtractedPhone[]
  urls: ExtractedUrl[]
}

export interface RuleContext {
  views: TextViews
  signals: Signals
  senderRole: SenderRole
  channel: Channel
  conversationKind: ConversationKind
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
  evaluate(ctx: RuleContext, config: C): RuleResult | null
}
