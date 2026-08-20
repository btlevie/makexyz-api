import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_files'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        .enum('status', ['pending', 'processing', 'completed', 'failed'])
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
