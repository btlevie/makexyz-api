/**
 * Message attachments (docs/plans/messaging_moderation.md, D7). The browser
 * uploads straight to S3 with a presigned PUT into a quarantine prefix the
 * app never serves from; once the upload is confirmed, ScanAttachment waits
 * for the malware scan (GuardDuty), inspects the bytes
 * (attachment_inspection.ts) and only then promotes a clean file to its
 * served location. A message with attachments still being checked is held
 * and judged again when the checks finish.
 *
 * Storage keys follow the project-file convention under a conversation
 * folder: `${S3_FILE_STORAGE_KEY}/conversations/<conversation>/<attachment>.<ext>`,
 * and the same under `${S3_FILE_STORAGE_KEY}/quarantine/` before promotion.
 */
import string from '@adonisjs/core/helpers/string'
import drive from '@adonisjs/drive/services/main'
import { DateTime } from 'luxon'
import env from '#start/env'
import AnalyzeMessage from '#jobs/analyze_message'
import ScanAttachment from '#jobs/scan_attachment'
import Conversation from '#models/conversation'
import type ConversationParticipant from '#models/conversation_participant'
import Message from '#models/message'
import MessageAttachment from '#models/message_attachment'
import { getMalwareScanner } from '#services/attachment_scanner'
import {
  ATTACHMENT_EXTENSIONS,
  inspectAttachment,
  type AttachmentExtension,
} from '#services/attachment_inspection'

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
/** Uploaded but not yet sent, per participant - stops a conversation being used as file storage. */
const MAX_UNSENT_ATTACHMENTS = 20
const UPLOAD_URL_EXPIRY = '15m'
const DOWNLOAD_URL_EXPIRY = '5m'
/** How often to look for the malware scanner's verdict, and how long to wait for it. */
const SCAN_POLL_DELAY = '20s'
const SCAN_WAIT_MINUTES = 15

export class AttachmentError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 422 = 422
  ) {
    super(message)
    this.name = 'AttachmentError'
  }
}

function extensionOf(fileName: string): AttachmentExtension | null {
  const extname = fileName.split('.').pop()?.toLowerCase() ?? ''
  return (ATTACHMENT_EXTENSIONS as readonly string[]).includes(extname)
    ? (extname as AttachmentExtension)
    : null
}

/** The file name as shown to people: no path, no control characters, bounded. */
function cleanFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  return (
    base
      .replace(/\p{Cc}/gu, '')
      .trim()
      .slice(-200) || 'file'
  )
}

function keyFor(conversation: Conversation, uuid: string, extname: string, quarantine: boolean) {
  const root = env.get('S3_FILE_STORAGE_KEY')
  return `${root}/${quarantine ? 'quarantine/' : ''}conversations/${conversation.uuid}/${uuid}.${extname}`
}

/** Creates the attachment record and a presigned PUT for the browser to upload to. */
export async function createUpload(
  conversation: Conversation,
  participant: ConversationParticipant,
  input: { fileName: string; sizeBytes: number }
): Promise<{ attachment: MessageAttachment; uploadUrl: string }> {
  const fileName = cleanFileName(input.fileName)
  const extname = extensionOf(fileName)
  if (!extname) {
    throw new AttachmentError(
      `This file type can't be attached. Allowed: ${ATTACHMENT_EXTENSIONS.join(', ')}.`
    )
  }
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError('Attachments can be up to 50 MB.')
  }
  const unsent = await MessageAttachment.query()
    .where('uploadedByParticipantId', participant.id)
    .whereNull('messageId')
    .whereNot('status', 'rejected')
    .count('* as total')
    .first()
  if (Number(unsent?.$extras.total ?? 0) >= MAX_UNSENT_ATTACHMENTS) {
    throw new AttachmentError('Too many unsent attachments. Send or discard some first.', 409)
  }

  const uuid = string.uuid()
  const quarantineKey = keyFor(conversation, uuid, extname, true)
  const attachment = await MessageAttachment.create({
    uuid,
    conversationId: conversation.id,
    uploadedByParticipantId: participant.id,
    fileName,
    extname,
    sizeBytes: input.sizeBytes,
    quarantineKey,
    status: 'pending_upload',
  })
  // ContentLength is signed into the URL (content-length header), so S3 refuses any other size.
  const uploadUrl = await drive.use('s3').getSignedUploadUrl(quarantineKey, {
    expiresIn: UPLOAD_URL_EXPIRY,
    ContentLength: input.sizeBytes,
  })
  return { attachment, uploadUrl }
}

/** The browser finished its PUT: check the object is there and queue the scan. */
export async function completeUpload(attachment: MessageAttachment): Promise<MessageAttachment> {
  if (attachment.status !== 'pending_upload') {
    return attachment
  }
  const disk = drive.use('s3')
  if (!(await disk.exists(attachment.quarantineKey))) {
    throw new AttachmentError('The file has not been uploaded yet.', 409)
  }
  const { contentLength } = await disk.getMetaData(attachment.quarantineKey)
  if (contentLength > MAX_ATTACHMENT_BYTES || contentLength !== attachment.sizeBytes) {
    await disk.delete(attachment.quarantineKey)
    attachment.merge({ status: 'rejected', rejectReason: 'size_mismatch' })
    await attachment.save()
    throw new AttachmentError("The uploaded file doesn't match its declared size.")
  }

  attachment.merge({ status: 'uploaded', uploadedAt: DateTime.now() })
  await attachment.save()
  await ScanAttachment.dispatch({ attachmentId: attachment.id }).run()
  return attachment
}

/**
 * The caller's own attachments for a message they're about to send: in this
 * conversation, not yet sent, uploaded (a rejected one is refused - its
 * status already told the sender why).
 */
export async function attachmentsForSend(
  conversation: Conversation,
  participant: ConversationParticipant,
  uuids: string[]
): Promise<MessageAttachment[]> {
  if (uuids.length === 0) return []
  if (uuids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new AttachmentError(`Up to ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message.`)
  }
  const attachments = await MessageAttachment.query()
    .where('conversationId', conversation.id)
    .where('uploadedByParticipantId', participant.id)
    .whereIn('uuid', uuids)
  if (attachments.length !== new Set(uuids).size) {
    throw new AttachmentError('Attachment not found.')
  }
  for (const attachment of attachments) {
    if (attachment.messageId !== null) {
      throw new AttachmentError('That attachment was already sent.', 409)
    }
    if (attachment.status === 'pending_upload') {
      throw new AttachmentError('Finish uploading the attachment before sending.', 409)
    }
    if (attachment.status === 'rejected') {
      throw new AttachmentError("An attachment didn't pass our security checks.")
    }
  }
  return attachments
}

/** Re-runs the message's moderation when the last of its attachments is checked. */
async function resumeMessage(attachment: MessageAttachment) {
  if (!attachment.messageId) return
  const message = await Message.find(attachment.messageId)
  if (message?.status === 'held') {
    await AnalyzeMessage.dispatch({ messageId: message.id })
      .dedup({ id: `analyze-${message.id}`, ttl: '10s' })
      .run()
  }
}

async function finish(
  attachment: MessageAttachment,
  status: 'clean' | 'rejected' | 'review',
  details: Record<string, unknown>,
  rejectReason: string | null = null
) {
  attachment.merge({
    status,
    rejectReason,
    scannedAt: DateTime.now(),
    scanDetails: { ...(attachment.scanDetails ?? {}), ...details },
  })
  await attachment.save()
  await resumeMessage(attachment)
}

/**
 * The ScanAttachment job's work: malware verdict, then content inspection,
 * then promotion. Re-queues itself while the scanner has no verdict yet; if
 * none arrives within SCAN_WAIT_MINUTES a person decides.
 */
export async function scanAttachment(attachmentId: number): Promise<void> {
  const attachment = await MessageAttachment.find(attachmentId)
  if (!attachment || attachment.status !== 'uploaded') {
    return
  }
  const disk = drive.use('s3')

  const malware = await getMalwareScanner().status(attachment.quarantineKey)
  if (malware === 'pending') {
    const waited = DateTime.now().diff(attachment.uploadedAt ?? DateTime.now(), 'minutes').minutes
    if (waited < SCAN_WAIT_MINUTES) {
      await ScanAttachment.dispatch({ attachmentId }).in(SCAN_POLL_DELAY).run()
      return
    }
  }
  if (malware === 'infected') {
    // Never promoted; the quarantined copy goes too.
    await disk.delete(attachment.quarantineKey)
    return finish(attachment, 'rejected', { malware }, 'malware')
  }

  const bytes = Buffer.from(await disk.getBytes(attachment.quarantineKey))
  const inspection = await inspectAttachment(bytes, attachment.extname as AttachmentExtension)
  const details = {
    malware,
    findings: inspection.findings,
    extractedText: inspection.extractedText,
  }
  attachment.contentType = inspection.contentType
  if (inspection.outcome === 'rejected') {
    await disk.delete(attachment.quarantineKey)
    return finish(attachment, 'rejected', details, inspection.reason)
  }

  // Promote: re-encoded images replace the upload; everything else is copied as-is.
  const conversation = await Conversation.findOrFail(attachment.conversationId)
  const storageKey = keyFor(conversation, attachment.uuid, attachment.extname, false)
  if (inspection.replacement) {
    await disk.put(storageKey, inspection.replacement, { contentType: inspection.contentType })
  } else {
    await disk.copy(attachment.quarantineKey, storageKey)
  }
  await disk.delete(attachment.quarantineKey)
  attachment.storageKey = storageKey
  if (inspection.replacement) attachment.sizeBytes = inspection.replacement.length

  // A clean result needs a scanner verdict too; without one a person checks it.
  const unverified = malware !== 'clean' || inspection.outcome === 'review'
  const reason =
    inspection.outcome === 'review' ? inspection.reason : unverified ? `malware_${malware}` : null
  return finish(attachment, unverified ? 'review' : 'clean', details, unverified ? reason : null)
}

/** A short-lived download link (forces a download, never inline rendering). */
export async function downloadUrl(attachment: MessageAttachment): Promise<string> {
  if (!attachment.storageKey) {
    throw new AttachmentError('This file is not available.', 409)
  }
  const safeName = attachment.fileName.replace(/["\\]/g, '_')
  return drive.use('s3').getSignedUrl(attachment.storageKey, {
    expiresIn: DOWNLOAD_URL_EXPIRY,
    contentType: attachment.contentType ?? 'application/octet-stream',
    contentDisposition: `attachment; filename="${safeName}"`,
  })
}

/** Marks a message's attachments that were waiting on a person as clean (moderator approval). */
export async function approveAttachments(message: Message) {
  await MessageAttachment.query()
    .where('messageId', message.id)
    .where('status', 'review')
    .whereNotNull('storageKey')
    .update({ status: 'clean', updated_at: DateTime.now().toSQL() })
}
