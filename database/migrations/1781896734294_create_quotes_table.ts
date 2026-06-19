import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'quotes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('project_id').unsigned().references('id').inTable('projects').onDelete('SET NULL')
      table.integer('created_by_id').unsigned().references('id').inTable('users').onDelete('SET NULL')
      table.integer('revision').notNullable()
      table.decimal('subtotal', 12, 2).notNullable()
      table.decimal('tax', 12, 2).notNullable()
      table.decimal('total', 12, 2).notNullable()
      table.enum('status', ['draft', 'sent', 'accepted', 'rejected']).notNullable().defaultTo('draft')
      table.text('notes').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}