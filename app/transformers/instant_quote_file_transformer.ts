import { BaseTransformer } from '@adonisjs/core/transformers'
import type Project from '#models/project'

export default class InstantQuoteFileTransformer extends BaseTransformer<Project> {
  async toObject() {
    await this.resource.load('projectFiles')

    return {
      project: {
        uuid: this.resource.uuid,
        status: this.resource.status,
        title: this.resource.title,
        files: this.resource.projectFiles.map((file) => ({
          id: file.id,
          originalName: file.originalName,
          mimeType: file.mimeType,
          size: file.fileSize,
        })),
      },
    }
  }
}
