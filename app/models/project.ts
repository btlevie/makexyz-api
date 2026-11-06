import { ProjectSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Conversation from '#models/conversation'
import Customer from '#models/customer'
import ProjectFile from '#models/project_file'
import Vendor from '#models/vendor'

export default class Project extends ProjectSchema {
  @hasMany(() => ProjectFile)
  declare projectFiles: HasMany<typeof ProjectFile>

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  /** Manual projects: the vendor it's directed to. */
  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>

  /** Manual projects: the inquiry thread it was started from. */
  @belongsTo(() => Conversation)
  declare conversation: BelongsTo<typeof Conversation>

  get isManual(): boolean {
    return this.source === 'manual'
  }
}
