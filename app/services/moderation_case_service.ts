/**
 * The human review queue (Step 1: the minimal version - see
 * docs/plans/messaging_moderation.md, "Human moderation"). A moderator
 * either approves a case's message (a held message is delivered, keeping its
 * original place in the thread) or blocks it (held -> blocked; already
 * delivered -> removed, shown to the recipient as a tombstone).
 */
import logger from '@adonisjs/core/services/logger'
import transmit from '@adonisjs/transmit/services/main'
import { DateTime } from 'luxon'
import Conversation from '#models/conversation'
import Message from '#models/message'
import type ModerationCase from '#models/moderation_case'
import type User from '#models/user'
import { conversationChannel, deliverHeldMessage } from '#services/message_service'

export const MODERATOR_BLOCK_REASON =
  "This message wasn't delivered because it doesn't follow MakeXYZ's messaging rules."

export class CaseAlreadyResolvedError extends Error {
  constructor() {
    super('This case has already been resolved')
    this.name = 'CaseAlreadyResolvedError'
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
export async function approveCase(moderationCase: ModerationCase, moderator: User, note?: string) {
  if (moderationCase.status === 'resolved') {
    throw new CaseAlreadyResolvedError()
  }

  const message = moderationCase.messageId ? await Message.find(moderationCase.messageId) : null
  if (message && (message.status === 'pending_review' || message.status === 'held')) {
    await deliverHeldMessage(message)
  }

  resolve(moderationCase, moderator, 'approved', note)
  await moderationCase.save()
  return moderationCase
}

/**
 * Blocks the case's message. A message still held becomes blocked (the sender
 * sees why); one already delivered is removed and the recipient's clients are
 * told to hide it.
 */
export async function blockCase(moderationCase: ModerationCase, moderator: User, note?: string) {
  if (moderationCase.status === 'resolved') {
    throw new CaseAlreadyResolvedError()
  }

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
  await moderationCase.save()
  return moderationCase
}
