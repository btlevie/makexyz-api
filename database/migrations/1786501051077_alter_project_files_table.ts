import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_files'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        // 'stored': a file kept as-is, never sliced - files a vendor copies
        // into a manual project from the inquiry thread (manual_project_service.ts).
        .enum('status', ['pending', 'processing', 'completed', 'failed', 'stored'])
        .notNullable()
        .defaultTo('pending')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('status')
    })
  }
}
