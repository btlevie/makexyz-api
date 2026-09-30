import { BaseTransformer } from '@adonisjs/core/transformers'
import type Message from '#models/message'

/**
 * A message as a participant sees it. `$extras.mine` (set by the controller)
 * decides how much is shown:
 * - The sender sees every message they sent, with its status - including
 *   held and blocked ones, and the reason a message was blocked.
 * - Everyone else only ever receives delivered messages, or a removed one as a
 *   tombstone with no body.
 * Moderation internals (rule ids, scores) are never exposed here.
 */
export default class MessageTransformer extends BaseTransformer<Message> {
  toObject() {
    const message = this.resource
    const mine = Boolean(message.$extras.mine)
    const removed = message.status === 'removed'
    const sender = message.sender

    return {
      uuid: message.uuid,
      seq: message.seq,
      kind: message.kind,
      mine,
      sender: sender ? { role: sender.role, displayName: sender.displayName } : null,
      body: removed ? null : message.body,
      removed,
      status: mine ? message.status : removed ? 'removed' : 'delivered',
      reason: mine && message.status === 'blocked' ? message.userFacingReason : null,
      ref: message.refType ? { type: message.refType, id: message.refId } : null,
      createdAt: message.createdAt,
      deliveredAt: message.deliveredAt,
    }
  }
}
