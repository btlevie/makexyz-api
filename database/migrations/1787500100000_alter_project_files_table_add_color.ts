import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_files'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('color')
      table
        .integer('color_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('material_colors')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('color_id')
      table.string('color').nullable()
    })
  }
}
