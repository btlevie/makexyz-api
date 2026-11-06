import { BaseTransformer } from '@adonisjs/core/transformers'
import ConversationParticipant from '#models/conversation_participant'
import type Project from '#models/project'
import ProjectFile from '#models/project_file'
import Conversation from '#models/conversation'

/**
 * A manual project as its vendor sees it. The customer appears as they do in
 * the thread (the participant display name) - never their email or address.
 * Storage keys never leave; files are downloaded through a short-lived link.
 */
export default class ManualProjectTransformer extends BaseTransformer<Project> {
  async toObject() {
    const project = this.resource
    const [files, conversation] = await Promise.all([
      ProjectFile.query().where('projectId', project.id).orderBy('id', 'asc'),
      project.conversationId ? Conversation.find(project.conversationId) : null,
    ])
    const customer = conversation
      ? await ConversationParticipant.query()
          .where('conversationId', conversation.id)
          .where('role', 'customer')
          .first()
      : null

    return {
      uuid: project.uuid,
      source: project.source,
      status: project.status,
      title: project.title,
      description: project.description,
      conversationUuid: conversation?.uuid ?? null,
      customer: customer ? { displayName: customer.displayName } : null,
      files: files.map((file) => ({
        uuid: file.uuid,
        originalName: file.originalName,
        mimeType: file.mimeType,
        fileSize: Number(file.fileSize),
        status: file.status,
        createdAt: file.createdAt,
      })),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }
  }
}
