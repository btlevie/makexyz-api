import type { HttpContext } from '@adonisjs/core/http'
import ProjectFile from '#models/project_file'
import { resolveVendor } from '#services/vendor_onboarding_service'
import {
  addFilesFromThread,
  createManualProject,
  findVendorInquiry,
  findVendorProject,
  listVendorProjects,
  ManualProjectError,
  projectFileDownloadUrl,
  removeProjectFile,
} from '#services/manual_project_service'
import ManualProjectTransformer from '#transformers/manual_project_transformer'
import {
  addManualProjectFilesValidator,
  createManualProjectValidator,
} from '#validators/manual_project'

/**
 * A vendor's manual projects (docs/plans/manual_quotes.md, section 3): started
 * from one of their inquiry threads, with files copied in from the thread's
 * scanned attachments. Only ever this vendor's own threads and projects -
 * anything else is a 404.
 */
export default class VendorManualProjectsController {
  /** POST /v1/vendor/inquiries/:conversationUuid/project */
  async store(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    const input = await ctx.request.validateUsing(createManualProjectValidator)
    try {
      const conversation = await findVendorInquiry(vendor, ctx.params.conversationUuid)
      const project = await createManualProject(
        vendor,
        conversation,
        input,
        ctx.auth.getUserOrFail().id
      )
      ctx.response.status(201)
      return await ctx.serialize(ManualProjectTransformer.transform(project))
    } catch (error) {
      return this.handleError(error, ctx.response)
    }
  }

  async index(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    return await ctx.serialize(ManualProjectTransformer.transform(await listVendorProjects(vendor)))
  }

  async show(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    try {
      const project = await findVendorProject(vendor, ctx.params.uuid)
      return await ctx.serialize(ManualProjectTransformer.transform(project))
    } catch (error) {
      return this.handleError(error, ctx.response)
    }
  }

  /** POST /v1/vendor/projects/:uuid/files - copy more attachments in from the thread. */
  async addFiles(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    const { attachmentUuids } = await ctx.request.validateUsing(addManualProjectFilesValidator)
    try {
      const project = await findVendorProject(vendor, ctx.params.uuid)
      await addFilesFromThread(vendor, project, attachmentUuids, ctx.auth.getUserOrFail().id)
      return await ctx.serialize(ManualProjectTransformer.transform(project))
    } catch (error) {
      return this.handleError(error, ctx.response)
    }
  }

  async destroyFile(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    try {
      const project = await findVendorProject(vendor, ctx.params.uuid)
      await removeProjectFile(project, ctx.params.fileUuid, ctx.auth.getUserOrFail().id)
      return ctx.response.noContent()
    } catch (error) {
      return this.handleError(error, ctx.response)
    }
  }

  /** A 5-minute download link for one of the project's files. */
  async downloadFile(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    try {
      const project = await findVendorProject(vendor, ctx.params.uuid)
      const file = await ProjectFile.query()
        .where('projectId', project.id)
        .where('uuid', ctx.params.fileUuid)
        .first()
      if (!file) {
        return ctx.response.notFound({ error: 'File not found' })
      }
      return await ctx.serialize({ url: await projectFileDownloadUrl(file), expiresInSeconds: 300 })
    } catch (error) {
      return this.handleError(error, ctx.response)
    }
  }

  private handleError(error: unknown, response: HttpContext['response']) {
    if (error instanceof ManualProjectError) {
      return response.status(error.status).send({ error: error.message })
    }
    throw error
  }
}
