import { ProjectFileSliceVariantSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ProjectFile from '#models/project_file'

export default class ProjectFileSliceVariant extends ProjectFileSliceVariantSchema {
  @belongsTo(() => ProjectFile)
  declare projectFile: BelongsTo<typeof ProjectFile>
}
