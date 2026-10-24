import { BaseTransformer } from '@adonisjs/core/transformers'
import type Message from '#models/message'
import env from '#start/env'

/**
 * A message as a participant sees it. `$extras.mine` (set by the controller)
 * decides how much is shown:
 * - The sender sees every message they sent, with its status - including
 *   held and blocked ones, and the reason a message was blocked.
 * - Everyone else only ever receives delivered messages, or a removed one as a
 *   tombstone with no body.
 * Moderation internals (rule ids, scores) are never exposed here.
 *
 * `links` (when `urls` is preloaded): each link as written, with the
 * interstitial that replaces it. Clients render the text and swap each
 * `match` for its `href` - links are never handed out raw, so one that turns
 * malicious later still can't be followed. `attachments` (when preloaded):
 * see MessageAttachmentTransformer.
 */
export default class MessageTransformer extends BaseTransformer<Message> {
  toObject() {
    const message = this.resource
    const mine = Boolean(message.$extras.mine)
    const removed = message.status === 'removed'
    const sender = message.sender
    const hidden = removed || message.status === 'blocked'
    const linksUrl = env.get('LINKS_URL', '')

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
      links: hidden
        ? []
        : (message.urls ?? []).map((url) => ({
            match: url.match,
            token: url.token,
            href: `${linksUrl}/${url.token}`,
          })),
      attachments: removed
        ? []
        : (message.attachments ?? [])
            .filter((file) => mine || file.status === 'clean')
            .map((file) => ({
              uuid: file.uuid,
              fileName: file.fileName,
              extname: file.extname,
              sizeBytes: file.sizeBytes,
              contentType: file.contentType,
              status: mine ? file.status : 'clean',
              available: file.status === 'clean',
            })),
      createdAt: message.createdAt,
      deliveredAt: message.deliveredAt,
    }
  }
}
