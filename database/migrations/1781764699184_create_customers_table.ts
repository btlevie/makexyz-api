import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'customers'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL')
      table.string('stripe_customer_id').nullable()
      table.string('paypal_customer_id').nullable()
      table.string('quickbooks_customer_id').nullable()
      table.string('first_name').nullable()
      table.string('last_name').nullable()
      table.string('company_name').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}