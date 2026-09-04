import { ProjectFileSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import ProjectFileSliceVariant from '#models/project_file_slice_variant'
import Material from '#models/material'
import MaterialColor from '#models/material_color'
import Project from '#models/project'

export default class ProjectFile extends ProjectFileSchema {
  @hasMany(() => ProjectFileSliceVariant)
  declare sliceVariants: HasMany<typeof ProjectFileSliceVariant>

  @belongsTo(() => Material)
  declare material: BelongsTo<typeof Material>

  @belongsTo(() => MaterialColor, { foreignKey: 'colorId' })
  declare color: BelongsTo<typeof MaterialColor>

  @belongsTo(() => Project)
  declare project: BelongsTo<typeof Project>
}
