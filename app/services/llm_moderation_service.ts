/**
 * LLM-assisted moderation (docs/plans/messaging_moderation.md, section 4):
 * only for messages the deterministic rules escalated - ambiguous, never
 * blocked. Builds minimal, pseudonymized context, asks the classifier, and
 * turns its verdict into allow / review / block with the plan's thresholds.
 *
 * The LLM can never un-block (blocked messages never reach it), can only
 * allow a message with no hard signals (an escalation by definition has
 * none), and every failure - an error, refusal, malformed reply, exhausted
 * budget - means a person decides. LLM_MODERATION_MODE turns it off, records
 * it in shadow, or lets it decide.
 */
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import env from '#start/env'
import type Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'
import Message from '#models/message'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import ModerationEvaluation from '#models/moderation_evaluation'
import Order from '#models/order'
import { accountAgeDays } from '#services/behavior_signal_service'
import { extractEmails, extractPhones } from '#services/moderation/extractors'
import {
  BedrockModerationClassifier,
  FakeModerationClassifier,
  type ClassifierResult,
  type LlmVerdict,
  type ModerationClassifier,
} from '#services/moderation/llm/classifier'
import { PROMPT_VERSION, type PromptContext } from '#services/moderation/llm/prompt'
import { buildViews } from '#services/moderation/normalizer'
import {
  moderateMessage,
  PIPELINE_VERSION,
  type ModerationOutcome,
} from '#services/moderation/pipeline'
import { analysisInput } from '#services/message_analysis_service'
import type { TrustTier } from '#services/messaging_risk_service'

export type LlmMode = 'off' | 'shadow' | 'enforce'

/** The thresholds from the plan: what the verdict must say to decide on its own. */
export const LLM_THRESHOLDS = {
  allowConfidence: 0.85,
  blockConfidence: 0.95,
  /** Only these categories may block automatically; the rest go to a person. */
  blockCategories: ['scam_phishing', 'off_platform_payment', 'off_platform_contact', 'spam'],
  /** Harassment and threats always go to a person, never auto-decided. */
  humanCategories: ['harassment', 'threat'],
  humanCategoryConfidence: 0.5,
}

const HISTORY_SIZE = 10
const DEFAULT_SENDER_HOURLY_BUDGET = 10
/** The same text from the same sender reuses a verdict for this long (spam blasts). */
const REUSE_WINDOW_HOURS = 24

export const fakeClassifier = new FakeModerationClassifier()
let classifier: ModerationClassifier | null = null

/** Test-only overrides - env values are fixed at boot. */
const overrides: { mode?: LlmMode; hourlyBudget?: number } = {}

export function overrideLlmSettings(settings: { mode?: LlmMode; hourlyBudget?: number } | null) {
  delete overrides.mode
  delete overrides.hourlyBudget
  if (settings) Object.assign(overrides, settings)
}

export function llmMode(): LlmMode {
  if (env.get('NODE_ENV') === 'test') {
    return overrides.mode ?? env.get('LLM_MODERATION_MODE', 'off')
  }
  // Without a region there's nothing to call - escalations go to a person.
  return env.get('BEDROCK_REGION') ? env.get('LLM_MODERATION_MODE', 'off') : 'off'
}

export function getClassifier(): ModerationClassifier {
  if (env.get('NODE_ENV') === 'test') return fakeClassifier
  classifier ??= new BedrockModerationClassifier()
  return classifier
}

/** What the pipeline does with the verdict. */
export type LlmOutcome = 'allow' | 'review' | 'block'

export interface LlmDecision {
  outcome: LlmOutcome
  /** Why, as a reason code stored on the message. */
  reasonCode: string
  /** Recorded on moderation_evaluations.llm. */
  record: Record<string, unknown>
}

/** Applies the plan's thresholds to a verdict. */
export function decide(verdict: LlmVerdict, injectionSuspected: boolean): LlmOutcome {
  const flaggedHuman = verdict.categories.some(
    (entry) =>
      LLM_THRESHOLDS.humanCategories.includes(entry.category) &&
      entry.confidence >= LLM_THRESHOLDS.humanCategoryConfidence
  )
  if (flaggedHuman) return 'review'

  if (verdict.recommendedAction === 'allow') {
    return verdict.confidence >= LLM_THRESHOLDS.allowConfidence && !injectionSuspected
      ? 'allow'
      : 'review'
  }
  if (verdict.recommendedAction === 'block') {
    const top = [...verdict.categories].sort((a, b) => b.confidence - a.confidence)[0]
    return verdict.confidence >= LLM_THRESHOLDS.blockConfidence &&
      top &&
      LLM_THRESHOLDS.blockCategories.includes(top.category)
      ? 'block'
      : 'review'
  }
  return 'review'
}

/** Emails and phone numbers out of anything sent to the model. */
export function redact(text: string): string {
  const views = buildViews(text)
  let redacted = text
  for (const email of extractEmails(views)) {
    redacted = redacted.replace(
      new RegExp(email.address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      '[email]'
    )
  }
  for (const phone of extractPhones(views)) {
    redacted = redacted.split(phone.match).join('[phone]')
  }
  return redacted
}

function age(from: DateTime | null, now: DateTime): string {
  if (!from) return 'unknown'
  const minutes = Math.max(0, Math.round(now.diff(from, 'minutes').minutes))
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1440)}d ago`
}

const ROLE_LABELS: Record<string, PromptContext['history'][number]['role']> = {
  customer: 'CUSTOMER',
  vendor: 'VENDOR',
  staff: 'STAFF',
}

/** The deal phase the plan asks for: inquiry before/after a quote, or the order's status. */
async function dealPhase(conversation: Conversation) {
  if (conversation.orderId) {
    const order = await Order.find(conversation.orderId)
    return { phase: order ? `order_${order.status}` : 'order', since: order?.updatedAt ?? null }
  }
  const quote = await Message.query()
    .where('conversationId', conversation.id)
    .where('kind', 'quote_ref')
    .orderBy('seq', 'desc')
    .first()
  return quote
    ? { phase: 'inquiry_quote_sent', since: quote.createdAt }
    : { phase: 'inquiry_no_quote', since: conversation.createdAt }
}

/** Pseudonymized context: roles and relative times only - no names, emails, phones, totals. */
export async function buildContext(
  message: Message,
  conversation: Conversation,
  sender: ConversationParticipant,
  outcome: ModerationOutcome,
  tier: TrustTier
): Promise<PromptContext> {
  const now = DateTime.now()
  const earlier = await Message.query()
    .where('conversationId', conversation.id)
    .where('seq', '<', message.seq)
    .orderBy('seq', 'desc')
    .limit(HISTORY_SIZE)
    .preload('sender')

  const history = earlier.reverse().map((row) => {
    const role = row.sender ? (ROLE_LABELS[row.sender.role] ?? 'STAFF') : 'SYSTEM'
    const delivered = row.status === 'delivered' || row.status === 'delivered_flagged'
    const text = delivered
      ? redact(row.body)
      : row.status === 'removed' || row.status === 'blocked'
        ? `[message withheld: reason=${row.blockReasonCode ?? 'unknown'}]`
        : `[message pending review]`
    return { role, age: age(row.createdAt, now), text }
  })

  const profile = await MessagingRiskProfile.query()
    .if(sender.customerId !== null, (query) => query.where('customerId', sender.customerId!))
    .if(sender.customerId === null, (query) => query.where('vendorId', sender.vendorId!))
    .first()
  const blocked30d = await Message.query()
    .where('senderParticipantId', sender.id)
    .where('status', 'blocked')
    .where('createdAt', '>', now.minus({ days: 30 }).toSQL()!)
    .count('* as total')
    .first()
  const phase = await dealPhase(conversation)

  return {
    message: redact(message.body),
    history,
    conversation: {
      kind: conversation.kind,
      dealPhase: phase.phase,
      daysInPhase: phase.since ? Math.floor(now.diff(phase.since, 'days').days) : null,
      direction: sender.role === 'vendor' ? 'vendor_to_customer' : `${sender.role}_to_other`,
      firstMessageOfInquiry: conversation.kind === 'inquiry' && message.seq === 1,
      channel: message.channel,
    },
    sender: {
      role: sender.role,
      accountAgeDays: await accountAgeDays({
        customerId: sender.customerId,
        vendorId: sender.vendorId,
      }),
      trustTier: tier,
      deliveredMessages: profile?.deliveredMessages ?? 0,
      blockedMessages30d: Number(blocked30d?.$extras.total ?? 0),
      confirmedViolations30d: profile?.confirmedViolations ?? 0,
      reportsReceived30d: profile?.reportsReceived ?? 0,
    },
    rulesFired: outcome.hits.map((hit) => ({
      ruleId: hit.ruleId,
      action: hit.shadow ? `${hit.action} (shadow)` : hit.action,
      reasonCode: hit.ruleId,
    })),
    links: outcome.signals.urls.map((url) => ({
      domain: url.hostname,
      list: url.list,
      flags: url.flags,
      verdict: url.scan?.verdict ?? 'not_analysed',
      domainAgeDays: url.scan?.domainAgeDays ?? null,
      redirectsTo: url.scan?.finalHostname ?? null,
    })),
  }
}

/** LLM calls for this sender in the last hour. */
async function callsLastHour(sender: ConversationParticipant): Promise<number> {
  const row = await db
    .from('moderation_evaluations')
    .join('messages', 'messages.id', 'moderation_evaluations.message_id')
    .whereNotNull('moderation_evaluations.llm')
    .where('moderation_evaluations.created_at', '>', DateTime.now().minus({ hours: 1 }).toSQL()!)
    .where((query) =>
      sender.customerId !== null
        ? query.where('messages.sender_customer_id', sender.customerId)
        : query.where('messages.sender_vendor_id', sender.vendorId!)
    )
    .count('* as total')
    .first()
  return Number(row?.total ?? 0)
}

/** A verdict already given for the same text from the same sender recently (a blast). */
async function reusableVerdict(message: Message, sender: ConversationParticipant) {
  if (!message.contentHash) return null
  const evaluation = await ModerationEvaluation.query()
    .whereNotNull('llm')
    .where('createdAt', '>', DateTime.now().minus({ hours: REUSE_WINDOW_HOURS }).toSQL()!)
    .whereIn('messageId', (query) =>
      query
        .from('messages')
        .where('content_hash', message.contentHash!)
        .whereNot('id', message.id)
        .where(
          sender.customerId !== null ? 'sender_customer_id' : 'sender_vendor_id',
          sender.customerId ?? sender.vendorId!
        )
        .select('id')
    )
    .orderBy('id', 'desc')
    .first()
  const llm = evaluation?.llm as { verdict?: LlmVerdict } | null | undefined
  return llm?.verdict ? llm.verdict : null
}

/**
 * Runs the LLM on an escalated message and decides what to do. Never throws
 * for model problems - those are a 'review' with the failure recorded.
 */
export async function classifyEscalation(input: {
  message: Message
  conversation: Conversation
  sender: ConversationParticipant
  outcome: ModerationOutcome
  tier: TrustTier
  mode: LlmMode
}): Promise<LlmDecision> {
  const { message, conversation, sender, outcome, tier, mode } = input
  const injectionSuspected = outcome.hits.some((hit) => hit.ruleId === 'llm.injection_text')
  const base = { mode, promptVersion: PROMPT_VERSION, injectionSuspected }

  const reused = await reusableVerdict(message, sender)
  if (reused) {
    const verdictOutcome = decide(reused, injectionSuspected)
    return {
      outcome: verdictOutcome,
      reasonCode: `llm.${verdictOutcome}`,
      record: { ...base, reused: true, verdict: reused, outcome: verdictOutcome },
    }
  }

  const budget =
    overrides.hourlyBudget ?? env.get('LLM_SENDER_HOURLY_BUDGET', DEFAULT_SENDER_HOURLY_BUDGET)
  if ((await callsLastHour(sender)) >= budget) {
    return {
      outcome: 'review',
      reasonCode: 'llm.budget_exceeded',
      record: { ...base, skipped: 'sender_budget', outcome: 'review' },
    }
  }

  const context = await buildContext(message, conversation, sender, outcome, tier)
  const result: ClassifierResult = await getClassifier().classify(context)
  if (!result.ok) {
    return {
      outcome: 'review',
      reasonCode: `llm.${result.failure}`,
      record: {
        ...base,
        model: result.model,
        failure: result.failure,
        detail: result.detail,
        usage: result.usage,
        latencyMs: result.latencyMs,
        outcome: 'review',
      },
    }
  }

  const verdictOutcome = decide(result.verdict, injectionSuspected)
  return {
    outcome: verdictOutcome,
    reasonCode: `llm.${verdictOutcome}`,
    record: {
      ...base,
      model: result.model,
      verdict: result.verdict,
      usage: result.usage,
      latencyMs: result.latencyMs,
      outcome: verdictOutcome,
    },
  }
}

/**
 * Shadow mode: the message already went to a person; record what the LLM
 * would have done, for comparing with the moderator's decision.
 */
export async function shadowClassify(messageId: number) {
  const message = await Message.find(messageId)
  if (!message?.senderParticipantId) return
  const sender = await ConversationParticipant.find(message.senderParticipantId)
  const conversation = await message.related('conversation').query().first()
  if (!sender || !conversation) return

  const { input, tier } = await analysisInput(message, conversation, sender)
  const outcome = await moderateMessage(input)
  const decision = await classifyEscalation({
    message,
    conversation,
    sender,
    outcome,
    tier,
    mode: 'shadow',
  })

  await ModerationEvaluation.create({
    messageId: message.id,
    stage: 'async',
    pipelineVersion: PIPELINE_VERSION,
    decision: decision.outcome,
    riskScore: outcome.riskScore,
    signals: null,
    rulesEvaluated: null,
    llm: decision.record,
    durationMs: Number(decision.record.latencyMs ?? 0),
  })
}

export interface LlmStats {
  days: number
  calls: number
  reused: number
  skippedForBudget: number
  failures: Record<string, number>
  outcomes: Record<string, number>
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  costUsd: number
  averageLatencyMs: number | null
  /** Messages a moderator has resolved: did the LLM's outcome match theirs? */
  moderatorAgreement: { compared: number; agreed: number }
}

/** Cost and quality numbers for the admin dashboard over the last `days`. */
export async function llmStats(days: number): Promise<LlmStats> {
  const evaluations = await ModerationEvaluation.query()
    .whereNotNull('llm')
    .where('createdAt', '>', DateTime.now().minus({ days }).toSQL()!)
    .select('messageId', 'llm')
  const resolved: { message_id: number; resolution: string | null }[] = await db
    .from('moderation_cases')
    .whereIn(
      'message_id',
      evaluations
        .map((evaluation) => evaluation.messageId)
        .filter((id): id is number => id !== null)
    )
    .where('status', 'resolved')
    .select('message_id', 'resolution')
  const resolutions = new Map(resolved.map((row) => [row.message_id, row.resolution]))

  const stats: LlmStats = {
    days,
    calls: 0,
    reused: 0,
    skippedForBudget: 0,
    failures: {},
    outcomes: {},
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    averageLatencyMs: null,
    moderatorAgreement: { compared: 0, agreed: 0 },
  }
  let latencyTotal = 0
  for (const evaluation of evaluations) {
    const llm = evaluation.llm as Record<string, any>
    const outcome = String(llm.outcome ?? 'review')
    stats.outcomes[outcome] = (stats.outcomes[outcome] ?? 0) + 1
    if (llm.reused) {
      stats.reused++
    } else if (llm.skipped) {
      stats.skippedForBudget++
    } else {
      stats.calls++
      latencyTotal += Number(llm.latencyMs ?? 0)
      if (llm.failure) stats.failures[llm.failure] = (stats.failures[llm.failure] ?? 0) + 1
      if (llm.usage) {
        stats.tokens.input += llm.usage.inputTokens ?? 0
        stats.tokens.output += llm.usage.outputTokens ?? 0
        stats.tokens.cacheRead += llm.usage.cacheReadTokens ?? 0
        stats.tokens.cacheWrite += llm.usage.cacheWriteTokens ?? 0
        stats.costUsd += llm.usage.costUsd ?? 0
      }
    }
    const resolution = evaluation.messageId ? resolutions.get(evaluation.messageId) : undefined
    if (resolution && outcome !== 'review' && !llm.failure) {
      stats.moderatorAgreement.compared++
      const moderatorAllowed = resolution === 'approved' || resolution === 'no_action'
      if ((outcome === 'allow') === moderatorAllowed) stats.moderatorAgreement.agreed++
    }
  }
  stats.costUsd = Number(stats.costUsd.toFixed(4))
  stats.averageLatencyMs = stats.calls > 0 ? Math.round(latencyTotal / stats.calls) : null
  return stats
}
