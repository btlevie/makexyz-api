import type { HttpContext } from '@adonisjs/core/http'
import Message, { DELIVERED_STATUSES } from '#models/message'
import MessageAttachment from '#models/message_attachment'
import MessageAttachmentTransformer from '#transformers/message_attachment_transformer'
import { createAttachmentValidator } from '#validators/messaging'
import { resolveConversation } from '#services/conversation_access_service'
import {
  AttachmentError,
  completeUpload,
  createUpload,
  downloadUrl,
} from '#services/attachment_service'

/**
 * Files in a conversation (see attachment_service.ts). The flow is:
 * 1. POST attachments - get a presigned PUT URL;
 * 2. PUT the file straight to S3 (exact size - it's signed into the URL);
 * 3. POST attachments/:uuid/complete - the scan starts;
 * 4. send a message with `attachmentUuids` (it's held until the scan ends);
 * 5. GET attachments/:uuid - status, and a download link once it's clean.
 * Participants only, 404 otherwise.
 */
export default class ConversationAttachmentsController {
  async store(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const access = await resolveConversation(ctx, params.uuid)
    if (!access || !access.participant) {
      return response.notFound({ error: 'Conversation not found' })
    }
    const input = await request.validateUsing(createAttachmentValidator)

    try {
      const { attachment, uploadUrl } = await createUpload(
        access.conversation,
        access.participant,
        input
      )
      response.status(201)
      return await serialize({
        attachment: await MessageAttachmentTransformer.transform(attachment),
        upload: {
          method: 'PUT',
          url: uploadUrl,
          headers: { 'Content-Length': String(attachment.sizeBytes) },
        },
      })
    } catch (error) {
      if (error instanceof AttachmentError) {
        return response.status(error.status).send({ error: error.message })
      }
      throw error
    }
  }

  async complete(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const access = await resolveConversation(ctx, params.uuid)
    if (!access || !access.participant) {
      return response.notFound({ error: 'Conversation not found' })
    }
    const attachment = await MessageAttachment.query()
      .where('uuid', params.attachmentUuid)
      .where('conversationId', access.conversation.id)
      .where('uploadedByParticipantId', access.participant.id)
      .first()
    if (!attachment) {
      return response.notFound({ error: 'Attachment not found' })
    }

    try {
      await completeUpload(attachment)
      return await serialize(MessageAttachmentTransformer.transform(attachment))
    } catch (error) {
      if (error instanceof AttachmentError) {
        return response.status(error.status).send({ error: error.message })
      }
      throw error
    }
  }

  /**
   * Status, plus a short-lived download link when the caller may have the
   * file: the uploader once it's clean; anyone else once it's clean and the
   * message carrying it has been delivered.
   */
  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const access = await resolveConversation(ctx, params.uuid)
    if (!access || !access.participant) {
      return response.notFound({ error: 'Conversation not found' })
    }
    const attachment = await MessageAttachment.query()
      .where('uuid', params.attachmentUuid)
      .where('conversationId', access.conversation.id)
      .first()
    if (!attachment) {
      return response.notFound({ error: 'Attachment not found' })
    }

    const uploader = attachment.uploadedByParticipantId === access.participant.id
    if (!uploader) {
      const message = attachment.messageId ? await Message.find(attachment.messageId) : null
      if (
        !message ||
        !DELIVERED_STATUSES.includes(message.status) ||
        attachment.status !== 'clean'
      ) {
        return response.notFound({ error: 'Attachment not found' })
      }
    }

    return await serialize({
      attachment: await MessageAttachmentTransformer.transform(attachment),
      downloadUrl: attachment.status === 'clean' ? await downloadUrl(attachment) : null,
    })
  }
}
