import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vendor_payouts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('vendor_id').unsigned().references('id').inTable('vendors').onDelete('CASCADE')
      table.integer('order_id').unsigned().references('id').inTable('orders').onDelete('CASCADE')
      table.string('provider').notNullable()
      table.string('provider_transaction_id').nullable()
      table.decimal('amount', 12, 2).notNullable()
      table.enum('status', ['pending', 'paid', 'failed', 'processing']).notNullable().defaultTo('pending')
      table.timestamp('paid_at')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}