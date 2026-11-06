import vine from '@vinejs/vine'
import { MAX_FILES_PER_REQUEST } from '#services/manual_project_service'

const attachmentUuids = () =>
  vine.array(vine.string().trim().uuid()).maxLength(MAX_FILES_PER_REQUEST).distinct()

/** POST /v1/vendor/inquiries/:conversationUuid/project */
export const createManualProjectValidator = vine.create({
  title: vine.string().trim().minLength(1).maxLength(200).optional(),
  description: vine.string().trim().maxLength(5000).nullable().optional(),
  attachmentUuids: attachmentUuids().optional(),
})

/** POST /v1/vendor/projects/:uuid/files */
export const addManualProjectFilesValidator = vine.create({
  attachmentUuids: attachmentUuids().minLength(1),
})
