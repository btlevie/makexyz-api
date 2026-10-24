import type { HttpContext } from '@adonisjs/core/http'
import MessageAttachment from '#models/message_attachment'
import { isAdmin } from '#services/project_grant_service'
import { downloadUrl } from '#services/attachment_service'

/**
 * Moderator download of an attachment under review. Rejected files (malware,
 * active PDFs) are never handed out, even to admins - their findings are on
 * the admin message view instead.
 */
export default class AdminAttachmentsController {
  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const attachment = await MessageAttachment.findBy('uuid', params.uuid)
    if (!attachment) {
      return response.notFound({ error: 'Attachment not found' })
    }
    if (attachment.status === 'rejected' || !attachment.storageKey) {
      return response.conflict({ error: 'This file is not available for download' })
    }
    return await serialize({
      uuid: attachment.uuid,
      fileName: attachment.fileName,
      status: attachment.status,
      scanDetails: attachment.scanDetails,
      downloadUrl: await downloadUrl(attachment),
    })
  }
}
