import { BaseTransformer } from '@adonisjs/core/transformers'
import type MessageAttachment from '#models/message_attachment'

/**
 * An attachment as a participant sees it. Its status tells the uploader how
 * far the checks have got; a file is only downloadable (`available`) once
 * clean. Scan internals stay admin-only.
 */
export default class MessageAttachmentTransformer extends BaseTransformer<MessageAttachment> {
  toObject() {
    const attachment = this.resource
    return {
      uuid: attachment.uuid,
      fileName: attachment.fileName,
      extname: attachment.extname,
      sizeBytes: attachment.sizeBytes,
      contentType: attachment.contentType,
      status: attachment.status,
      available: attachment.status === 'clean',
      createdAt: attachment.createdAt,
    }
  }
}
