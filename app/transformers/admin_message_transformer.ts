import { BaseTransformer } from '@adonisjs/core/transformers'
import type Message from '#models/message'

/**
 * A message as an admin sees it: every status, the internal reason code and
 * the rules that fired (when `ruleHits` is preloaded on $extras by the
 * controller), so a moderator can see why it was held, blocked or let through.
 */
export default class AdminMessageTransformer extends BaseTransformer<Message> {
  toObject() {
    const message = this.resource
    const sender = message.sender
    return {
      uuid: message.uuid,
      seq: message.seq,
      kind: message.kind,
      channel: message.channel,
      sender: sender ? { role: sender.role, displayName: sender.displayName } : null,
      body: message.body,
      status: message.status,
      blockReasonCode: message.blockReasonCode,
      userFacingReason: message.userFacingReason,
      ruleHits: (message.$extras.ruleHits ?? []) as {
        ruleId: string
        ruleVersion: number
        action: string
        shadow: boolean
        evidence: unknown
      }[],
      createdAt: message.createdAt,
      deliveredAt: message.deliveredAt,
      removedAt: message.removedAt,
    }
  }
}
