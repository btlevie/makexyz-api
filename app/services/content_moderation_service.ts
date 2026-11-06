/**
 * Moderating text that isn't a message: a vendor's public profile (display
 * name, bio, service descriptions) and text found inside a vendor image (QR
 * codes). It's the same synchronous pipeline as messages
 * (moderation/pipeline.ts) with `kind = 'profile'`, recorded against a
 * subject instead of a message so the same evaluations, rule hits and case
 * tooling cover it (docs/plans/manual_quotes.md, section 11).
 *
 * Outcome -> what happens:
 *   allow                  -> approved
 *   flag                   -> approved, plus an auto_flag case for a later look
 *   hold / review / escalate -> pending_review, plus an auto_hold case: the
 *                             content stays out of public view until a
 *                             moderator approves it (no LLM pass for profiles)
 *   block                  -> blocked: nothing is saved, the caller returns
 *                             the reason; a prohibited item also opens a case
 * A restricted or suspended author's content is always pending_review.
 */
import string from '@adonisjs/core/helpers/string'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import ModerationCase from '#models/moderation_case'
import ModerationEvaluation from '#models/moderation_evaluation'
import ModerationRuleHit from '#models/moderation_rule_hit'
import { effectiveTrustTier } from '#services/messaging_risk_service'
import { GENERIC_BLOCK_REASON } from '#services/message_service'
import {
  moderateMessage,
  PIPELINE_VERSION,
  type ModerationOutcome,
} from '#services/moderation/pipeline'

export type ContentSubjectType = NonNullable<ModerationEvaluation['subjectType']>

export type ContentStatus = 'approved' | 'pending_review' | 'blocked'

export interface ContentSubject {
  type: ContentSubjectType
  id: number
  /** Whose content it is - the case subject. */
  vendorId?: number | null
  customerId?: number | null
}

export interface ContentModerationResult {
  status: ContentStatus
  outcome: ModerationOutcome
  /** Shown to the author when blocked. */
  reason: string | null
}

/** Review-queue priorities, matching message_service.ts. */
const PRIORITY = { auto_hold: 40, auto_flag: 80, prohibited_item: 30 } as const

export function statusForDecision(decision: ModerationOutcome['decision']): ContentStatus {
  if (decision === 'block') return 'blocked'
  if (decision === 'allow' || decision === 'flag') return 'approved'
  return 'pending_review'
}

async function recordSubjectEvaluation(
  subject: ContentSubject,
  outcome: ModerationOutcome,
  trx: TransactionClientContract
) {
  const evaluation = await ModerationEvaluation.create(
    {
      messageId: null,
      subjectType: subject.type,
      subjectId: subject.id,
      stage: 'sync',
      pipelineVersion: PIPELINE_VERSION,
      decision: outcome.decision,
      riskScore: outcome.riskScore,
      signals: outcome.signals,
      rulesEvaluated: outcome.rulesEvaluated,
      llm: null,
      context: outcome.replay,
      durationMs: outcome.durationMs,
    },
    { client: trx }
  )
  if (outcome.hits.length > 0) {
    await ModerationRuleHit.createMany(
      outcome.hits.map((hit) => ({ ...hit, evaluationId: evaluation.id, messageId: null })),
      { client: trx }
    )
  }
  return evaluation
}

/**
 * Closes the subject's open cases as superseded - the content they were about
 * has been replaced, so approving one must not approve the new text unseen.
 */
export async function supersedeOpenCases(
  subject: Pick<ContentSubject, 'type' | 'id'>,
  trx?: TransactionClientContract
) {
  await ModerationCase.query(trx ? { client: trx } : {})
    .where('subjectType', subject.type)
    .where('subjectId', subject.id)
    .whereNot('status', 'resolved')
    .update({
      status: 'resolved',
      resolution: 'no_action',
      resolved_at: DateTime.now().toSQL(),
      pattern_note: 'Superseded: the content was edited before review',
      updated_at: DateTime.now().toSQL(),
    })
}

async function openSubjectCase(
  subject: ContentSubject,
  source: keyof typeof PRIORITY,
  outcome: ModerationOutcome,
  trx: TransactionClientContract
) {
  await ModerationCase.create(
    {
      uuid: string.uuid(),
      messageId: null,
      subjectType: subject.type,
      subjectId: subject.id,
      customerId: subject.customerId ?? null,
      vendorId: subject.vendorId ?? null,
      source,
      priority: PRIORITY[source],
      status: 'open',
      missedByAutomation: false,
      details: {
        subject: subject.type,
        reasonCode: outcome.reasonCode,
        decision: outcome.decision,
      },
    },
    { client: trx }
  )
}

/**
 * Moderates `text` as `subject`'s content and records the evaluation (and
 * any case). Earlier open cases on the subject are superseded unless the
 * new text is blocked (in which case nothing changed).
 */
export async function moderateContent(
  subject: ContentSubject,
  text: string,
  options: { senderRole?: 'vendor' | 'customer'; supersede?: boolean } = {}
): Promise<ContentModerationResult> {
  const senderRole = options.senderRole ?? (subject.vendorId ? 'vendor' : 'customer')
  const tier = await effectiveTrustTier({
    customerId: subject.customerId ?? undefined,
    vendorId: subject.vendorId ?? undefined,
  })
  const outcome = await moderateMessage({
    text,
    senderRole,
    channel: 'web',
    conversation: { kind: 'profile', isFirstMessage: false, orderStatus: null },
    trustTier: tier,
  })
  // A restricted or suspended author's content always waits for a person, as their messages do.
  const restricted = tier === 'restricted' || tier === 'suspended'
  const decided = statusForDecision(outcome.decision)
  const status = decided === 'approved' && restricted ? 'pending_review' : decided

  await db.transaction(async (trx) => {
    if (status !== 'blocked' && options.supersede !== false) {
      await supersedeOpenCases(subject, trx)
    }
    await recordSubjectEvaluation(subject, outcome, trx)
    if (status === 'blocked' && outcome.caseSource) {
      await openSubjectCase(subject, outcome.caseSource, outcome, trx)
    } else if (status === 'pending_review') {
      await openSubjectCase(subject, 'auto_hold', outcome, trx)
    } else if (outcome.decision === 'flag') {
      await openSubjectCase(subject, 'auto_flag', outcome, trx)
    }
  })

  return {
    status,
    outcome,
    reason: status === 'blocked' ? (outcome.userFacingReason ?? GENERIC_BLOCK_REASON) : null,
  }
}
