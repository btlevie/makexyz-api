/**
 * Everything a moderator needs about one case in one response
 * (docs/plans/messaging_moderation.md, section 8 "The case detail endpoint"):
 * the message with its evidence highlighted, the thread around it (withheld
 * messages included), who the participants really are, the sender's risk
 * profile and past cases, the order, every link and attachment with its
 * analysis, every moderation pass with the rules that fired and the score
 * breakdown against the tier's thresholds, the LLM verdict, reports, and the
 * actions already taken. Admin-only.
 */
import { DateTime } from 'luxon'
import Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'
import Customer from '#models/customer'
import Message from '#models/message'
import MessageReport from '#models/message_report'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import ModerationAction from '#models/moderation_action'
import ModerationCase from '#models/moderation_case'
import ModerationEvaluation from '#models/moderation_evaluation'
import ModerationRuleHit from '#models/moderation_rule_hit'
import Order from '#models/order'
import Project from '#models/project'
import UrlDomain from '#models/url_domain'
import User from '#models/user'
import Vendor from '#models/vendor'
import { loadReviewDetails } from '#services/message_review_details'
import { claimIsActive } from '#services/moderation_case_service'
import { SCORE_THRESHOLDS } from '#services/moderation/combiner'
import type { TrustTier } from '#services/messaging_risk_service'
import type { Evidence } from '#services/moderation/types'
import { getDomain } from 'tldts'

const CONTEXT_MESSAGES = 10
const SUBJECT_HISTORY = 20

/** Where each evidence span sits in the message body, for highlighting. */
export function highlights(body: string, hits: { ruleId: string; evidence: Evidence[] | null }[]) {
  const lower = body.toLowerCase()
  const spans: { start: number; end: number; ruleId: string; match: string }[] = []
  for (const hit of hits) {
    for (const evidence of hit.evidence ?? []) {
      const match = evidence.match.toLowerCase()
      if (!match) continue
      let from = 0
      let index = lower.indexOf(match, from)
      while (index !== -1) {
        spans.push({
          start: index,
          end: index + match.length,
          ruleId: hit.ruleId,
          match: evidence.match,
        })
        from = index + match.length
        index = lower.indexOf(match, from)
      }
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

async function identity(participant: ConversationParticipant) {
  if (participant.role === 'customer' && participant.customerId) {
    const customer = await Customer.find(participant.customerId)
    const user = customer?.userId ? await User.find(customer.userId) : null
    return {
      role: 'customer',
      displayName: participant.displayName,
      uuid: customer?.uuid ?? null,
      name: [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || null,
      email: user?.email ?? customer?.email ?? null,
      guest: !customer?.userId,
    }
  }
  if (participant.role === 'vendor' && participant.vendorId) {
    const vendor = await Vendor.find(participant.vendorId)
    const user = vendor?.userId ? await User.find(vendor.userId) : null
    return {
      role: 'vendor',
      displayName: participant.displayName,
      uuid: vendor?.uuid ?? null,
      name: vendor?.displayName ?? null,
      email: user?.email ?? null,
      status: vendor?.status ?? null,
    }
  }
  return { role: participant.role, displayName: participant.displayName }
}

async function subjectHistory(moderationCase: ModerationCase) {
  const subject = moderationCase.vendorId
    ? { column: 'vendorId' as const, id: moderationCase.vendorId }
    : moderationCase.customerId
      ? { column: 'customerId' as const, id: moderationCase.customerId }
      : null
  if (!subject) return { profile: null, pastCases: [], blockedMessages30d: 0 }

  const profile = await MessagingRiskProfile.query().where(subject.column, subject.id).first()
  const pastCases = await ModerationCase.query()
    .where(subject.column, subject.id)
    .whereNot('id', moderationCase.id)
    .orderBy('id', 'desc')
    .limit(SUBJECT_HISTORY)
  const blocked = await Message.query()
    .where(subject.column === 'vendorId' ? 'senderVendorId' : 'senderCustomerId', subject.id)
    .where('status', 'blocked')
    .where('createdAt', '>', DateTime.now().minus({ days: 30 }).toSQL()!)
    .count('* as total')
    .first()

  return {
    profile: profile
      ? {
          trustTier: profile.trustTier,
          tierSource: profile.tierSource,
          restrictionExpiresAt: profile.restrictionExpiresAt,
          holdUntil: profile.holdUntil,
          holdReason: profile.holdReason,
          deliveredMessages: profile.deliveredMessages,
          confirmedViolations30d: profile.confirmedViolations,
          reportsReceived30d: profile.reportsReceived,
          vendorBlocks30d: profile.vendorBlocks,
        }
      : null,
    pastCases: pastCases.map((past) => ({
      uuid: past.uuid,
      source: past.source,
      status: past.status,
      resolution: past.resolution,
      abuseCategory: past.abuseCategory,
      createdAt: past.createdAt,
    })),
    blockedMessages30d: Number(blocked?.$extras.total ?? 0),
  }
}

async function evaluationsOf(message: Message) {
  const evaluations = await ModerationEvaluation.query()
    .where('messageId', message.id)
    .orderBy('id', 'asc')
  const hits = await ModerationRuleHit.query().where('messageId', message.id)
  return evaluations.map((evaluation) => {
    const own = hits.filter((hit) => hit.evaluationId === evaluation.id)
    const tier = (evaluation.context?.trustTier ?? 'standard') as TrustTier
    return {
      stage: evaluation.stage,
      pipelineVersion: evaluation.pipelineVersion,
      decision: evaluation.decision,
      riskScore: evaluation.riskScore,
      trustTier: tier,
      thresholds: SCORE_THRESHOLDS[tier],
      rulesEvaluated: evaluation.rulesEvaluated ?? [],
      hits: own.map((hit) => ({
        ruleId: hit.ruleId,
        ruleVersion: hit.ruleVersion,
        configVersion: hit.configVersion,
        action: hit.action,
        weight: hit.weight,
        shadow: hit.shadow,
        evidence: hit.evidence,
      })),
      // The enforced weights behind riskScore, largest first.
      scoreBreakdown: own
        .filter((hit) => !hit.shadow && hit.weight > 0)
        .map((hit) => ({ ruleId: hit.ruleId, weight: hit.weight }))
        .sort((a, b) => b.weight - a.weight),
      behavior: evaluation.context?.history ?? null,
      llm: evaluation.llm,
      createdAt: evaluation.createdAt,
    }
  })
}

export async function caseDetail(moderationCase: ModerationCase) {
  const message = moderationCase.messageId ? await Message.find(moderationCase.messageId) : null
  const conversation = message ? await Conversation.find(message.conversationId) : null

  let thread: Message[] = []
  let participants: unknown[] = []
  let order: Record<string, unknown> | null = null
  if (message && conversation) {
    thread = await Message.query()
      .where('conversationId', conversation.id)
      .whereBetween('seq', [message.seq - CONTEXT_MESSAGES, message.seq + CONTEXT_MESSAGES])
      .orderBy('seq', 'asc')
      .preload('sender')
    await message.load('sender')
    await loadReviewDetails([message])
    const members = await ConversationParticipant.query().where('conversationId', conversation.id)
    participants = await Promise.all(members.map(identity))
    if (conversation.orderId) {
      const row = await Order.find(conversation.orderId)
      const project = row ? await Project.find(row.projectId) : null
      order = row
        ? {
            uuid: row.uuid,
            orderNumber: row.orderNumber,
            status: row.status,
            project: project ? { uuid: project.uuid, status: project.status } : null,
          }
        : null
    }
  }

  // Links: their analysis plus how widely the domain has been seen.
  const links = (message?.$extras.links ?? []) as { domain: string }[]
  const domains = [
    ...new Set(links.map((link) => getDomain(link.domain)).filter(Boolean)),
  ] as string[]
  const domainRows = await UrlDomain.query().whereIn('domain', domains)
  const enrichedLinks = links.map((link) => {
    const row = domainRows.find((domain) => domain.domain === getDomain(link.domain))
    return {
      ...link,
      seenCount: row?.seenCount ?? 0,
      firstSeenAt: row?.firstSeenAt ?? null,
      registeredAt: row?.registeredAt ?? null,
    }
  })

  const reports = message
    ? await MessageReport.query().where('messageId', message.id).orderBy('id', 'asc')
    : []
  const reporters = await ConversationParticipant.query().whereIn(
    'id',
    reports.map((report) => report.reporterParticipantId)
  )
  const actions = await ModerationAction.query()
    .where('caseId', moderationCase.id)
    .orderBy('id', 'asc')
  const assignee = moderationCase.assignedToId ? await User.find(moderationCase.assignedToId) : null
  const evaluations = message ? await evaluationsOf(message) : []

  return {
    case: {
      uuid: moderationCase.uuid,
      source: moderationCase.source,
      priority: moderationCase.priority,
      status: moderationCase.status,
      resolution: moderationCase.resolution,
      abuseCategory: moderationCase.abuseCategory,
      patternNote: moderationCase.patternNote,
      missedByAutomation: moderationCase.missedByAutomation,
      details: moderationCase.details,
      claim: claimIsActive(moderationCase)
        ? { by: assignee?.email ?? null, at: moderationCase.claimedAt }
        : null,
      createdAt: moderationCase.createdAt,
      resolvedAt: moderationCase.resolvedAt,
    },
    message: message
      ? {
          uuid: message.uuid,
          seq: message.seq,
          kind: message.kind,
          channel: message.channel,
          body: message.body,
          status: message.status,
          blockReasonCode: message.blockReasonCode,
          userFacingReason: message.userFacingReason,
          sender: message.sender
            ? { role: message.sender.role, displayName: message.sender.displayName }
            : null,
          highlights: highlights(message.body, (message.$extras.ruleHits ?? []) as never[]),
          links: enrichedLinks,
          attachments: message.$extras.attachments ?? [],
          createdAt: message.createdAt,
          deliveredAt: message.deliveredAt,
        }
      : null,
    conversation: conversation
      ? {
          uuid: conversation.uuid,
          kind: conversation.kind,
          status: conversation.status,
          closedReason: conversation.closedReason,
          subject: conversation.subject,
          order,
          participants,
        }
      : null,
    thread: thread.map((row) => ({
      uuid: row.uuid,
      seq: row.seq,
      kind: row.kind,
      sender: row.sender ? { role: row.sender.role, displayName: row.sender.displayName } : null,
      body: row.body,
      status: row.status,
      blockReasonCode: row.blockReasonCode,
      current: row.id === message?.id,
      createdAt: row.createdAt,
    })),
    subject: await subjectHistory(moderationCase),
    evaluations,
    reports: reports.map((report) => ({
      uuid: report.uuid,
      reason: report.reason,
      note: report.note,
      reporterRole:
        reporters.find((participant) => participant.id === report.reporterParticipantId)?.role ??
        null,
      createdAt: report.createdAt,
    })),
    actions: actions.map((action) => ({
      action: action.action,
      actorUserId: action.actorUserId,
      targetType: action.targetType,
      targetId: action.targetId,
      reason: action.reason,
      metadata: action.metadata,
      createdAt: action.createdAt,
    })),
  }
}
