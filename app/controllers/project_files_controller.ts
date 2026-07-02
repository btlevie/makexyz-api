import string from '@adonisjs/core/helpers/string'
import type { HttpContext } from '@adonisjs/core/http'
import Customer from '#models/customer'
import Project from '#models/project'
import { uploadProjectFileValidator } from '#validators/project_file'
import InstantQuoteFileTransformer from '#transformers/instant_quote_file_transformer'
import env from '#start/env'
import ProjectFile from '#models/project_file'

export default class ProjectFilesController {
  async store({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { files, projectUuid } = await request.validateUsing(uploadProjectFileValidator)

    const customer = await Customer.firstOrCreate(
      { userId: user.id },
      { userId: user.id, uuid: string.uuid() }
    )

    const project = await Project.firstOrCreate(
      {
        uuid: projectUuid,
      },
      {
        uuid: string.uuid(),
        customerId: customer.id,
        status: 'draft',
      }
    )

    for (const file of files) {
      const fileUuid = string.uuid()
      const storageKey = `${env.get('S3_FILE_STORAGE_KEY')}/${project.uuid}/${fileUuid}.${file.extname}`
      await file.moveToDisk(storageKey)
      await ProjectFile.create({
        projectId: project.id,
        uuid: fileUuid,
        fileStorageKey: storageKey,
        originalName: file.clientName,
        mimeType: file.type ?? 'application/octet-stream',
        fileSize: file.size,
      })
    }

    return await serialize(
      InstantQuoteFileTransformer.transform(project)
    )
  }
}
