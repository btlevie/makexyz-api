import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'checkout_sessions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('quote_id').unsigned().references('id').inTable('quotes').onDelete('CASCADE')
      table.integer('projet_id').unsigned().references('id').inTable('projects').onDelete('CASCADE')
      table.integer('customer_id').unsigned().references('id').inTable('customers').onDelete('CASCADE')
      table.enum('status', ['active', 'expired', 'completed', 'failed']).notNullable().defaultTo('active')
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}