import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'quote_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('quote_id').unsigned().references('id').inTable('quotes').onDelete('CASCADE')
      table.integer('project_file_id').unsigned().references('id').inTable('project_files').onDelete('SET NULL')
      table.string('item_type')
      table.text('description').nullable()
      table.decimal('unit_price', 12, 2).notNullable()
      table.integer('quantity').notNullable()
      table.decimal('total', 12, 2).notNullable()
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}