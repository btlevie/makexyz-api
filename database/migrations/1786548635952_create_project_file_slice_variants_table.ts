import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_file_slice_variants'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('project_file_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('project_files')
        .onDelete('CASCADE')
      table.string('variant', 255).notNullable()
      table.integer('infill').notNullable()
      table.double('layer_height').notNullable()
      table.double('filament_used_grams').notNullable()
      table.integer('print_time_estimated_seconds').notNullable()
      table.string('gcode_storage_key').notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['project_file_id', 'variant'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
