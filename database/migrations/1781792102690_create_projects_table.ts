import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'projects'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('customer_id').unsigned().references('id').inTable('customers').onDelete('SET NULL')
      table.string('title')
      table.text('description').nullable()
      table.enum('status', ['draft' , 'quoted', 'awaiting_checkout', 'ordered', 'fulfilled', 'cancelled']).notNullable().defaultTo('draft')
      table.jsonb('metadata').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}