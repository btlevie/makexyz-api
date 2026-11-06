/**
 * Manual projects (docs/plans/manual_quotes.md, section 3): a vendor turns an
 * inquiry into a project they'll quote by hand. Only the thread's own vendor
 * can create one, for the thread's customer.
 *
 * - `source = 'manual'`, `vendor_id` = this vendor, `customer_id` = the
 *   thread's customer, `conversation_id` = the thread. The conversation's
 *   `project_id` points at the latest one; one inquiry can lead to several
 *   projects over time (repeat work).
 * - Files are the thread's own scanned attachments, chosen by the vendor and
 *   **copied** into project storage under the usual
 *   `${S3_FILE_STORAGE_KEY}/${projectUuid}/${fileUuid}.${ext}` key. They're
 *   `status = 'stored'` with no technology, material or slicing job: a manual
 *   price doesn't need slicer output.
 * - Only attachments that passed every check (status `clean`, promoted out of
 *   quarantine) on a message that was actually delivered can be copied. A
 *   quarantined or rejected file is never touched.
 *
 * The instant-quote cleanup jobs and endpoints leave manual projects alone
 * (see the `source` guards in expire/purge and ProjectFilesController).
 */
import string from '@adonisjs/core/helpers/string'
import drive from '@adonisjs/drive/services/main'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import AuditEvent from '#models/audit_event'
import Conversation from '#models/conversation'
import { DELIVERED_STATUSES } from '#models/message'
import MessageAttachment from '#models/message_attachment'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import QuoteItem from '#models/quote_item'
import type Vendor from '#models/vendor'

/** Up to this many files copied in one request. */
export const MAX_FILES_PER_REQUEST = 20

export class ManualProjectError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 422
  ) {
    super(message)
    this.name = 'ManualProjectError'
  }
}

/**
 * The vendor's own inquiry thread with a customer, or a 404 - another
 * vendor's thread is indistinguishable from one that doesn't exist.
 */
export async function findVendorInquiry(vendor: Vendor, conversationUuid: string) {
  const conversation = await Conversation.query()
    .where('uuid', conversationUuid)
    .where('kind', 'inquiry')
    .where('vendorId', vendor.id)
    .first()
  if (!conversation) {
    throw new ManualProjectError('Conversation not found', 404)
  }
  return conversation
}

/** One of this vendor's manual projects, or a 404. */
export async function findVendorProject(vendor: Vendor, projectUuid: string): Promise<Project> {
  const project = await Project.query()
    .where('uuid', projectUuid)
    .where('source', 'manual')
    .where('vendorId', vendor.id)
    .first()
  if (!project) {
    throw new ManualProjectError('Project not found', 404)
  }
  return project
}

function assertVendorCanWork(vendor: Vendor) {
  // A suspended vendor finishes accepted work but takes on no new work.
  if (vendor.status !== 'active') {
    throw new ManualProjectError('Only active vendors can start projects', 409)
  }
}

/**
 * The attachments a vendor asked to copy, checked: in this thread, scanned
 * clean, sent on a delivered message. Throws on the first one that isn't.
 */
async function copyableAttachments(
  conversation: Conversation,
  uuids: string[]
): Promise<MessageAttachment[]> {
  if (uuids.length === 0) return []
  if (uuids.length > MAX_FILES_PER_REQUEST) {
    throw new ManualProjectError(`Up to ${MAX_FILES_PER_REQUEST} files at a time.`)
  }
  const attachments = await MessageAttachment.query()
    .where('conversationId', conversation.id)
    .whereIn('uuid', uuids)
  if (attachments.length !== new Set(uuids).size) {
    throw new ManualProjectError('Attachment not found in this conversation.', 404)
  }

  const messageIds = attachments
    .map((attachment) => attachment.messageId)
    .filter((id): id is number => id !== null)
  const deliveredRows =
    messageIds.length === 0
      ? []
      : await db
          .from('messages')
          .whereIn('id', messageIds)
          .whereIn('status', [...DELIVERED_STATUSES])
          .select('id')
  const delivered = new Set(deliveredRows.map((row) => Number(row.id)))

  for (const attachment of attachments) {
    if (attachment.status !== 'clean' || !attachment.storageKey) {
      throw new ManualProjectError(
        `"${attachment.fileName}" hasn't passed its security checks and can't be added.`,
        409
      )
    }
    if (attachment.messageId === null || !delivered.has(attachment.messageId)) {
      throw new ManualProjectError(`"${attachment.fileName}" wasn't delivered in this thread.`, 409)
    }
  }
  return attachments
}

/**
 * Copies attachments into the project's storage and records them as project
 * files. An attachment already in the project is skipped (idempotent).
 */
async function copyIntoProject(
  project: Project,
  attachments: MessageAttachment[],
  trx?: TransactionClientContract
): Promise<ProjectFile[]> {
  const options = trx ? { client: trx } : {}
  const existing = await ProjectFile.query(options)
    .where('projectId', project.id)
    .whereIn(
      'messageAttachmentId',
      attachments.map((attachment) => attachment.id)
    )
  const already = new Set(existing.map((file) => file.messageAttachmentId))

  const disk = drive.use('s3')
  const created: ProjectFile[] = []
  for (const attachment of attachments) {
    if (already.has(attachment.id)) continue
    const fileUuid = string.uuid()
    const storageKey = `${env.get('S3_FILE_STORAGE_KEY')}/${project.uuid}/${fileUuid}.${attachment.extname}`
    await disk.copy(attachment.storageKey!, storageKey)
    created.push(
      await ProjectFile.create(
        {
          uuid: fileUuid,
          projectId: project.id,
          messageAttachmentId: attachment.id,
          fileStorageKey: storageKey,
          originalName: attachment.fileName,
          mimeType: attachment.contentType ?? 'application/octet-stream',
          fileSize: attachment.sizeBytes,
          technology: null,
          materialId: null,
          colorId: null,
          status: 'stored',
        },
        options
      )
    )
  }
  return created
}

async function audit(project: Project, userId: number | null, action: string, details = {}) {
  await AuditEvent.create({
    entityType: 'project',
    entityId: project.id,
    eventType: 'updated',
    userId,
    payload: { action, projectUuid: project.uuid, ...details },
  })
}

export interface CreateManualProjectInput {
  title?: string | null
  description?: string | null
  attachmentUuids?: string[]
}

/**
 * Starts a manual project from the vendor's inquiry thread, copying in the
 * chosen attachments. The thread must still be open (a declined, blocked or
 * closed inquiry can't become work).
 */
export async function createManualProject(
  vendor: Vendor,
  conversation: Conversation,
  input: CreateManualProjectInput,
  actorUserId: number | null
): Promise<Project> {
  assertVendorCanWork(vendor)
  if (conversation.kind !== 'inquiry' || conversation.vendorId !== vendor.id) {
    throw new ManualProjectError('Conversation not found', 404)
  }
  if (conversation.status !== 'open') {
    throw new ManualProjectError('This conversation is closed.', 409)
  }
  if (!conversation.customerId) {
    throw new ManualProjectError('This conversation has no customer.', 409)
  }

  const attachments = await copyableAttachments(conversation, input.attachmentUuids ?? [])

  const project = await db.transaction(async (trx) => {
    const created = await Project.create(
      {
        uuid: string.uuid(),
        source: 'manual',
        status: 'draft',
        customerId: conversation.customerId,
        vendorId: vendor.id,
        conversationId: conversation.id,
        title: input.title?.trim() || conversation.subject || 'Custom quote',
        description: input.description?.trim() || null,
      },
      { client: trx }
    )
    await Conversation.query({ client: trx })
      .where('id', conversation.id)
      .update({ project_id: created.id })
    conversation.projectId = created.id
    return created
  })

  // Copied after the project exists (its uuid is in the key). A copy failure
  // leaves the project with the files that made it; the vendor can retry.
  await copyIntoProject(project, attachments)
  await audit(project, actorUserId, 'manual_project_created', {
    conversationUuid: conversation.uuid,
    vendorUuid: vendor.uuid,
    files: attachments.length,
  })
  return project
}

/** Copies more attachments from the project's thread into it. */
export async function addFilesFromThread(
  vendor: Vendor,
  project: Project,
  attachmentUuids: string[],
  actorUserId: number | null
): Promise<ProjectFile[]> {
  assertVendorCanWork(vendor)
  if (!project.conversationId) {
    throw new ManualProjectError("This project isn't linked to a conversation.", 409)
  }
  assertEditable(project)
  const conversation = await Conversation.findOrFail(project.conversationId)
  const attachments = await copyableAttachments(conversation, attachmentUuids)
  const created = await copyIntoProject(project, attachments)
  if (created.length > 0) {
    await audit(project, actorUserId, 'manual_project_files_added', { files: created.length })
  }
  return created
}

function assertEditable(project: Project) {
  if (!['draft', 'quoted'].includes(project.status)) {
    throw new ManualProjectError(`A ${project.status} project's files can't change.`, 409)
  }
}

/**
 * Removes a file from the project (and its copy from storage). A file a quote
 * line refers to stays - the quote is a snapshot of what was offered.
 */
export async function removeProjectFile(
  project: Project,
  fileUuid: string,
  actorUserId: number | null
): Promise<void> {
  assertEditable(project)
  const file = await ProjectFile.query()
    .where('projectId', project.id)
    .where('uuid', fileUuid)
    .first()
  if (!file) {
    throw new ManualProjectError('File not found', 404)
  }
  const quoted = await QuoteItem.query().where('projectFileId', file.id).first()
  if (quoted) {
    throw new ManualProjectError('This file is on a quote and can no longer be removed.', 409)
  }
  await file.delete()
  await drive
    .use('s3')
    .delete(file.fileStorageKey)
    .catch(() => {})
  await audit(project, actorUserId, 'manual_project_file_removed', { fileUuid })
}

/** A short-lived download link for a project file (forces a download). */
export async function projectFileDownloadUrl(file: ProjectFile): Promise<string> {
  const safeName = file.originalName.replace(/["\\]/g, '_')
  return drive.use('s3').getSignedUrl(file.fileStorageKey, {
    expiresIn: '5m',
    contentType: file.mimeType || 'application/octet-stream',
    contentDisposition: `attachment; filename="${safeName}"`,
  })
}

/** The vendor's manual projects, newest first. */
export async function listVendorProjects(vendor: Vendor): Promise<Project[]> {
  return Project.query()
    .where('source', 'manual')
    .where('vendorId', vendor.id)
    .preload('conversation')
    .preload('projectFiles')
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(200)
}
