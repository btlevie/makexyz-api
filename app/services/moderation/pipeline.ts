/**
 * The synchronous moderation pass, run before a message is stored or
 * delivered: normalize -> extract -> look up history -> rules -> combine.
 * Pure CPU plus a couple of indexed reads, so it stays in the request path
 * (see docs/plans/messaging_moderation.md, "Process placement").
 *
 * It decides; it doesn't persist. message_service.ts stores the message, the
 * evaluation and the rule hits in one transaction with the outcome.
 */
import { createHash } from 'node:crypto'
import { buildViews } from '#services/moderation/normalizer'
import { extractSignals } from '#services/moderation/extractors'
import { combine, type FiredRule } from '#services/moderation/combiner'
import { getActiveRules } from '#services/moderation/rule_registry'
import {
  getEffectiveDomainLists,
  type EffectiveDomainLists,
} from '#services/moderation/url/domain_registry'
import { lookupScans } from '#services/moderation/url/scan_lookup'
import type { TrustTier } from '#services/messaging_risk_service'
import type {
  AttachmentSignal,
  Channel,
  ConversationContext,
  Decision,
  Evidence,
  HistoryLookups,
  RuleAction,
  RuleResult,
  SenderRole,
  Signals,
  TextViews,
} from '#services/moderation/types'

/** Bumped when the normalizer or extractors change, so old evaluations stay explainable. */
export const PIPELINE_VERSION = '3'

const NO_HISTORY: HistoryLookups = { sameTextOtherConversations: 0, sameTextOtherSenders: 0 }

export interface ModerationInput {
  text: string
  senderRole: SenderRole
  channel: Channel
  conversation: ConversationContext
  trustTier?: TrustTier
  /** Behavioral lookups keyed by the normalized text's hash (see message_service.ts). */
  history?: (contentHash: string) => Promise<HistoryLookups>
  /** Files sent with the message. Their names are moderated with the text. */
  attachments?: AttachmentSignal[]
  /**
   * Text found inside attachments - decoded QR codes, PDF link targets.
   * Moderated with the message, so a QR code with a phone number is still
   * contact sharing and its links go through the URL rules.
   */
  attachmentText?: string[]
  /** Defaults to the effective lists (built-ins + url_domains). */
  domainLists?: EffectiveDomainLists
}

export interface HitRecord {
  ruleId: string
  ruleVersion: number
  configVersion: number
  action: RuleAction
  weight: number
  shadow: boolean
  evidence: Evidence[]
}

export interface ModerationOutcome {
  decision: Decision
  riskScore: number
  views: TextViews
  signals: Signals
  /** sha256 of the normalized text - exact-duplicate detection. */
  contentHash: string
  rulesEvaluated: string[]
  hits: HitRecord[]
  /** The rule behind the decision, for the message's reason fields. */
  reasonCode: string | null
  userFacingReason: string | null
  /** Set when the deciding rule asks for a moderation case (e.g. a prohibited item). */
  caseSource: RuleResult['caseSource'] | null
  durationMs: number
}

export function hashNormalized(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex')
}

export async function moderateMessage(input: ModerationInput): Promise<ModerationOutcome> {
  const startedAt = performance.now()
  const attachments = input.attachments ?? []
  const attachmentText = input.attachmentText ?? []
  // File names are moderated as text: "call me 555 0123.pdf" is still contact sharing.
  const views = buildViews(
    [input.text, ...attachments.map((file) => file.fileName), ...attachmentText].join('\n')
  )
  const lists = input.domainLists ?? (await getEffectiveDomainLists())
  const signals = extractSignals(views, lists)
  signals.attachments = attachments
  if (attachmentText.length > 0) {
    const body = buildViews(input.text)
    for (const url of signals.urls) {
      const inBody =
        body.deobfuscated.includes(url.match) || body.raw.toLowerCase().includes(url.match)
      url.source = inBody ? 'text' : 'attachment'
    }
  }
  const scans = await lookupScans(signals.urls, lists)
  for (const url of signals.urls) {
    url.scan = scans.get(url.hash) ?? null
  }
  const contentHash = hashNormalized(views.normalized)
  const history = input.history ? await input.history(contentHash) : NO_HISTORY

  const context = {
    views,
    signals,
    senderRole: input.senderRole,
    channel: input.channel,
    conversation: input.conversation,
    history,
    trustTier: input.trustTier ?? 'standard',
  }

  const activeRules = await getActiveRules()
  const rules = activeRules.filter(({ rule }) =>
    rule.senderRoles ? rule.senderRoles.includes(input.senderRole) : input.senderRole !== 'staff'
  )

  const fired: FiredRule[] = []
  const hits: HitRecord[] = []
  for (const { rule, mode, config, configVersion } of rules) {
    const result = rule.evaluate(context, config)
    if (!result) {
      continue
    }
    const shadow = mode === 'shadow'
    fired.push({ ruleId: rule.id, result, shadow })
    hits.push({
      ruleId: rule.id,
      ruleVersion: rule.version,
      configVersion,
      action: result.action,
      weight: result.weight ?? 0,
      shadow,
      evidence: result.evidence,
    })
  }

  const { decision, riskScore, decidedBy } = combine(fired, input.trustTier ?? 'standard')

  return {
    decision,
    riskScore,
    views,
    signals,
    contentHash,
    rulesEvaluated: rules.map(({ rule }) => `${rule.id}@${rule.version}`),
    hits,
    reasonCode: decidedBy?.result.reasonCode ?? null,
    userFacingReason: decidedBy?.result.userMessage ?? null,
    caseSource: decision === 'block' ? (decidedBy?.result.caseSource ?? null) : null,
    durationMs: Math.round(performance.now() - startedAt),
  }
}
