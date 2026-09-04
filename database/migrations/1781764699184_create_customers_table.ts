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
      // Set for leads captured from the instant-quote flow, who have no user
      // account (user_id stays null). Nullable-unique: many customers have no
      // email of their own because theirs lives on users, while a returning
      // lead reuses the single row for their address.
      table.string('email', 254).nullable().unique()
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