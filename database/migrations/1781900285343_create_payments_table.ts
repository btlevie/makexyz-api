import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'payments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('checkout_session_id').unsigned().references('id').inTable('checkout_sessions').onDelete('SET NULL')
      table.string('provider')
      table.string('transaction_id')
      table.decimal('provider_fee', 12, 2).notNullable()
      table.decimal('amount', 12, 2).notNullable()
      table.decimal('net_amount', 12, 2).notNullable()
      table.enum('status', ['pending', 'authorized', 'captured', 'failed', 'refunded', 'cancelled']).notNullable().defaultTo('pending')
      table.timestamp('authorized_at')
      table.timestamp('captured_at')
      table.timestamp('failed_at')
      table.timestamp('refunded_at')
      table.timestamp('cancelled_at')
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}