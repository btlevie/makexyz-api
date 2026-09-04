import { BaseTransformer } from '@adonisjs/core/transformers'
import type Project from '#models/project'

export default class InstantQuoteFileTransformer extends BaseTransformer<Project> {
  /**
   * `grant` is the signed token an anonymous caller needs to act on this project
   * again. Null for authenticated callers, who are already authorized through
   * their Customer.
   */
  constructor(
    project: Project,
    private grant: string | null = null
  ) {
    super(project)
  }

  async toObject() {
    await this.resource.load('projectFiles')

    return {
      project: {
        uuid: this.resource.uuid,
        status: this.resource.status,
        title: this.resource.title,
        files: this.resource.projectFiles.map((file) => ({
          // uuid, not the numeric id - this endpoint is public, and uuid is the
          // external identifier everywhere else in the API.
          uuid: file.uuid,
          originalName: file.originalName,
          mimeType: file.mimeType,
          size: file.fileSize,
          technology: file.technology,
          status: file.status,
        })),
      },
      ...(this.grant ? { grant: this.grant } : {}),
    }
  }
}
