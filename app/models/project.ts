import { ProjectSchema } from '#database/schema'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import ProjectFile from '#models/project_file'

export default class Project extends ProjectSchema {
  @hasMany(() => ProjectFile)
  declare projectFiles: HasMany<typeof ProjectFile>
}