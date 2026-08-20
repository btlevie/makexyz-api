import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_files'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.double('support_material_grams').nullable()
      table.double('model_material_grams').nullable()
      table.integer('print_time_estimated_seconds').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('support_material_grams')
      table.dropColumn('model_material_grams')
      table.dropColumn('print_time_estimated_seconds')
    })
  }
}
