/**
 * The human review queue (see docs/plans/messaging_moderation.md, "Human
 * moderation"). A moderator can:
 * - approve a case's message (a held message is delivered, keeping its
 *   original place in the thread, and attachments the scanner couldn't
 *   check become downloadable);
 * - block it (held -> blocked; already delivered -> removed, shown to the
 *   recipient as a tombstone);
 * - restrict or suspend the sender's messaging, or lift that;
 * - warn the sender (a private email), close the conversation early;
 * - label the case (abuse category, pattern note, missed by automation) -
 *   what the pattern-discovery loop and per-rule precision learn from.
 * A moderator claims a case while working it (CLAIM_MINUTES), so two don't
 * act on the same one. Every decision is recorded in moderation_actions.
 */
import logger from '@adonisjs/core/services/logger'
import mail from '@adonisjs/mail/services/main'
import db from '@adonisjs/lucid/services/db'
import transmit from '@adonisjs/transmit/services/main'
import { DateTime } from 'luxon'
import Conversation from '#models/conversation'
import Customer from '#models/customer'
import Message from '#models/message'
import type ModerationCase from '#models/moderation_case'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import User from '#models/user'
import Vendor from '#models/vendor'
import { conversationChannel, deliverHeldMessage } from '#services/message_service'
import { recordModerationAction } from '#services/moderation_action_service'
import { closeConversationByStaff } from '#services/conversation_service'
import ModerationWarningNotification from '#mails/moderation_warning_notification'
import { approveAttachments } from '#services/attachment_service'
import { principalOf, refreshRiskProfile } from '#services/messaging_risk_service'

export const MODERATOR_BLOCK_REASON =
  "This message wasn't delivered because it doesn't follow MakeXYZ's messaging rules."

export class CaseAlreadyResolvedError extends Error {
  constructor() {
    super('This case has already been resolved')
    this.name = 'CaseAlreadyResolvedError'
  }
}

export class CaseClaimedError extends Error {
  constructor() {
    super('Another moderator is working this case')
    this.name = 'CaseClaimedError'
  }
}

/** A claim lapses after this long, so an abandoned case returns to the queue. */
export const CLAIM_MINUTES = 30

/** What a moderator's label says (the LLM categories, with 'none' for a clean message). */
export interface CaseLabel {
  abuseCategory?: string
  patternNote?: string
  missedByAutomation?: boolean
}

export function claimIsActive(moderationCase: ModerationCase, now = DateTime.now()): boolean {
  return (
    moderationCase.status === 'claimed' &&
    moderationCase.claimedAt !== null &&
    moderationCase.claimedAt > now.minus({ minutes: CLAIM_MINUTES })
  )
}

/** Another moderator's live claim stops anyone else acting on the case. */
export function assertCanAct(moderationCase: ModerationCase, moderator: User) {
  if (moderationCase.status === 'resolved') {
    throw new CaseAlreadyResolvedError()
  }
  if (claimIsActive(moderationCase) && moderationCase.assignedToId !== moderator.id) {
    throw new CaseClaimedError()
  }
}

function applyLabel(moderationCase: ModerationCase, label?: CaseLabel) {
  if (!label) return
  moderationCase.merge({
    abuseCategory: label.abuseCategory ?? moderationCase.abuseCategory,
    patternNote: label.patternNote ?? moderationCase.patternNote,
    missedByAutomation: label.missedByAutomation ?? moderationCase.missedByAutomation,
  })
}

export class CaseHasNoSubjectError extends Error {
  constructor() {
    super('This case has no customer or vendor to restrict')
    this.name = 'CaseHasNoSubjectError'
  }
}

function resolve(
  moderationCase: ModerationCase,
  moderator: User,
  resolution: NonNullable<ModerationCase['resolution']>,
  note?: string
) {
  moderationCase.merge({
    status: 'resolved',
    resolution,
    resolvedById: moderator.id,
    resolvedAt: DateTime.now(),
    patternNote: note ?? moderationCase.patternNote,
  })
}

/** Approves the case's message: a held message is delivered now. */
export async function approveCase(
  moderationCase: ModerationCase,
  moderator: User,
  note?: string,
  label?: CaseLabel
) {
  assertCanAct(moderationCase, moderator)

  const message = moderationCase.messageId ? await Message.find(moderationCase.messageId) : null
  if (message && (message.status === 'pending_review' || message.status === 'held')) {
    // Attachments the scanner couldn't vouch for were part of what was reviewed.
    await approveAttachments(message)
    await deliverHeldMessage(message)
  }

  resolve(moderationCase, moderator, 'approved', note)
  applyLabel(moderationCase, label)
  await moderationCase.save()
  if (message) {
    await recordModerationAction({
      actorUserId: moderator.id,
      caseId: moderationCase.id,
      action: 'approve_message',
      targetType: 'message',
      targetId: message.uuid,
      reason: note,
    })
  }
  return moderationCase
}

/**
 * Blocks the case's message. A message still held becomes blocked (the sender
 * sees why); one already delivered is removed and the recipient's clients are
 * told to hide it.
 */
export async function blockCase(
  moderationCase: ModerationCase,
  moderator: User,
  note?: string,
  label?: CaseLabel
) {
  assertCanAct(moderationCase, moderator)

  const message = moderationCase.messageId ? await Message.find(moderationCase.messageId) : null
  let resolution: NonNullable<ModerationCase['resolution']> = 'no_action'

  if (message && (message.status === 'pending_review' || message.status === 'held')) {
    message.merge({
      status: 'blocked',
      blockReasonCode: 'moderator',
      userFacingReason: MODERATOR_BLOCK_REASON,
    })
    await message.save()
    resolution = 'blocked'
  } else if (
    message &&
    (message.status === 'delivered' || message.status === 'delivered_flagged')
  ) {
    message.merge({ status: 'removed', removedAt: DateTime.now(), blockReasonCode: 'moderator' })
    await message.save()
    resolution = 'removed'
    const conversation = await Conversation.find(message.conversationId)
    if (conversation) {
      try {
        transmit.broadcast(conversationChannel(conversation), {
          event: 'message.removed',
          messageUuid: message.uuid,
          seq: message.seq,
        })
      } catch (error) {
        logger.error({ error: String(error) }, 'Failed to broadcast a removed message')
      }
    }
  }

  resolve(moderationCase, moderator, resolution, note)
  applyLabel(moderationCase, label)
  await moderationCase.save()
  if (message && resolution !== 'no_action') {
    await recordModerationAction({
      actorUserId: moderator.id,
      caseId: moderationCase.id,
      action: resolution === 'removed' ? 'remove_message' : 'block_message',
      targetType: 'message',
      targetId: message.uuid,
      reason: note,
    })
    // A confirmed violation: the sender may now cross the automatic restriction threshold.
    await refreshRiskProfile(principalOf(message))
  }
  return moderationCase
}

/**
 * Sets the case subject's messaging tier: 'restricted' (every message goes
 * to review), 'suspended' (can't send, except in a live order thread, where
 * it's treated as restricted), or 'standard' to lift a restriction. Messaging
 * only - never touches ordering, quoting or fulfilment. Doesn't resolve the
 * case, so the moderator can still approve or block its message.
 */
export async function restrictCaseSubject(
  moderationCase: ModerationCase,
  moderator: User,
  input: { tier: 'restricted' | 'suspended' | 'standard'; days?: number; note?: string }
): Promise<MessagingRiskProfile> {
  if (claimIsActive(moderationCase) && moderationCase.assignedToId !== moderator.id) {
    throw new CaseClaimedError()
  }
  const principal = moderationCase.vendorId
    ? { vendorId: moderationCase.vendorId }
    : moderationCase.customerId
      ? { customerId: moderationCase.customerId }
      : null
  if (!principal) {
    throw new CaseHasNoSubjectError()
  }

  const expiresAt =
    input.tier === 'standard' || !input.days ? null : DateTime.now().plus({ days: input.days })
  const target = principal.vendorId
    ? await Vendor.findOrFail(principal.vendorId)
    : await Customer.findOrFail(principal.customerId!)
  const targetUuid = target.uuid

  const lifting = input.tier === 'standard'
  const updated = await db.transaction(async (trx) => {
    // Lifting hands the tier back to the automatic rules - without letting
    // the violations already reviewed restrict the sender again at once.
    const profile = await MessagingRiskProfile.updateOrCreate(
      principal,
      {
        trustTier: input.tier,
        restrictionExpiresAt: expiresAt,
        tierSource: lifting ? 'auto' : 'manual',
        ...(lifting ? { holdUntil: null, holdReason: null, autoRestrictedAt: DateTime.now() } : {}),
      },
      { client: trx }
    )
    await recordModerationAction(
      {
        actorUserId: moderator.id,
        caseId: moderationCase.id,
        action:
          input.tier === 'standard'
            ? 'lift_restriction'
            : input.tier === 'suspended'
              ? 'suspend_user'
              : 'restrict_user',
        targetType: principal.vendorId ? 'vendor' : 'customer',
        targetId: targetUuid,
        reason: input.note,
        metadata: { tier: input.tier, expiresAt: expiresAt?.toISO() ?? null },
      },
      trx
    )
    return profile
  })
  if (lifting) {
    return (await refreshRiskProfile(principal)) ?? updated
  }
  return updated
}

/** Takes a case for this moderator (or renews their claim). A lapsed claim can be taken over. */
export async function claimCase(moderationCase: ModerationCase, moderator: User) {
  assertCanAct(moderationCase, moderator)
  moderationCase.merge({ status: 'claimed', assignedToId: moderator.id, claimedAt: DateTime.now() })
  await moderationCase.save()
  return moderationCase
}

/** Puts a claimed case back in the queue. */
export async function releaseCase(moderationCase: ModerationCase, moderator: User) {
  assertCanAct(moderationCase, moderator)
  moderationCase.merge({ status: 'open', assignedToId: null, claimedAt: null })
  await moderationCase.save()
  return moderationCase
}

/**
 * Labels a case without resolving it (or relabels a resolved one) - the
 * category, a pattern note, and whether automation missed it. This is what
 * the discovery loop and per-rule precision learn from.
 */
export async function labelCase(moderationCase: ModerationCase, moderator: User, label: CaseLabel) {
  if (claimIsActive(moderationCase) && moderationCase.assignedToId !== moderator.id) {
    throw new CaseClaimedError()
  }
  const before = {
    abuseCategory: moderationCase.abuseCategory,
    missedByAutomation: moderationCase.missedByAutomation,
  }
  applyLabel(moderationCase, label)
  await moderationCase.save()
  await recordModerationAction({
    actorUserId: moderator.id,
    caseId: moderationCase.id,
    action: 'label_case',
    targetType: 'case',
    targetId: moderationCase.uuid,
    reason: label.patternNote ?? null,
    metadata: { before, after: label },
  })
  return moderationCase
}

async function subjectAddress(moderationCase: ModerationCase) {
  if (moderationCase.vendorId) {
    const vendor = await Vendor.find(moderationCase.vendorId)
    const user = vendor?.userId ? await User.find(vendor.userId) : null
    return vendor && user ? { email: user.email, type: 'vendor', uuid: vendor.uuid } : null
  }
  if (moderationCase.customerId) {
    const customer = await Customer.find(moderationCase.customerId)
    const user = customer?.userId ? await User.find(customer.userId) : null
    const email = user?.email ?? customer?.email ?? null
    return customer && email ? { email, type: 'customer', uuid: customer.uuid } : null
  }
  return null
}

/**
 * Warns the case subject by private email - a system message in the thread
 * would be seen by the other participant too. Doesn't resolve the case.
 */
export async function warnCaseSubject(
  moderationCase: ModerationCase,
  moderator: User,
  warning: string
) {
  if (claimIsActive(moderationCase) && moderationCase.assignedToId !== moderator.id) {
    throw new CaseClaimedError()
  }
  const subject = await subjectAddress(moderationCase)
  if (!subject) {
    throw new CaseHasNoSubjectError()
  }
  await mail.send(new ModerationWarningNotification(subject.email, warning))
  await recordModerationAction({
    actorUserId: moderator.id,
    caseId: moderationCase.id,
    action: 'warn_user',
    targetType: subject.type,
    targetId: subject.uuid,
    reason: warning,
  })
}

export class CaseHasNoConversationError extends Error {
  constructor() {
    super('This case has no conversation to close')
    this.name = 'CaseHasNoConversationError'
  }
}

/** Closes the case's conversation early: read-only, with a note in the thread. */
export async function closeCaseConversation(
  moderationCase: ModerationCase,
  moderator: User,
  note?: string
) {
  if (claimIsActive(moderationCase) && moderationCase.assignedToId !== moderator.id) {
    throw new CaseClaimedError()
  }
  const message = moderationCase.messageId ? await Message.find(moderationCase.messageId) : null
  const conversation = message ? await Conversation.find(message.conversationId) : null
  if (!conversation) {
    throw new CaseHasNoConversationError()
  }
  if (conversation.status === 'open') {
    await closeConversationByStaff(conversation)
  }
  await recordModerationAction({
    actorUserId: moderator.id,
    caseId: moderationCase.id,
    action: 'close_conversation',
    targetType: 'conversation',
    targetId: conversation.uuid,
    reason: note ?? null,
  })
  return conversation
}
