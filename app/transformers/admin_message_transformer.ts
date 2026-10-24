import { BaseTransformer } from '@adonisjs/core/transformers'
import type Message from '#models/message'

/**
 * A message as an admin sees it: every status, the internal reason code, the
 * rules that fired, its links with their reputation and its attachments with
 * what the checks found (all set on $extras by message_review_details.ts), so
 * a moderator can see why it was held, blocked or let through.
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
      links: (message.$extras.links ?? []) as {
        url: string
        domain: string
        source: string
        scan: Record<string, unknown> | null
      }[],
      attachments: (message.$extras.attachments ?? []) as {
        uuid: string
        fileName: string
        status: string
        rejectReason: string | null
        scanDetails: unknown
      }[],
      createdAt: message.createdAt,
      deliveredAt: message.deliveredAt,
      removedAt: message.removedAt,
    }
  }
}
