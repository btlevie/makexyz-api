import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_files'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Last-known progress from the slicer's best-effort progress callback.
      // Both null until the first progress event arrives - transmit doesn't
      // buffer missed events, so a reconnecting client recovers current state
      // from these via a plain GET instead of only the live stream.
      table.integer('slicing_progress_percent').nullable()
      table.string('slicing_progress_stage').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('slicing_progress_percent')
      table.dropColumn('slicing_progress_stage')
    })
  }
}
