import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_files'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('project_id').unsigned().references('id').inTable('projects').onDelete('SET NULL')
      table.integer('material_id').unsigned().references('id').inTable('materials').onDelete('SET NULL')
      table.string('file_storage_key').notNullable()
      table.string('gcode_storage_key')
      table.string('original_name').notNullable()
      table.string('mime_type').notNullable()
      table.bigint('file_size').notNullable()
      table.double('volume')
      table.double('x')
      table.double('y')
      table.double('z')
      table.string('color')
      table.integer('infill')
      table.double('layer_height')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}