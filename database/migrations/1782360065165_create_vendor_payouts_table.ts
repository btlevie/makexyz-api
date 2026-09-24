import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vendor_payouts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('vendor_id').unsigned().references('id').inTable('vendors').onDelete('CASCADE')
      // Unique: one payout per order, so a double payout is impossible here
      // regardless of what the application layer does.
      table
        .integer('order_id')
        .unsigned()
        .unique()
        .references('id')
        .inTable('orders')
        .onDelete('CASCADE')
      table.enum('provider', ['stripe', 'paypal']).notNullable()
      // Stripe transfer id, or PayPal payout item id.
      table.string('provider_transaction_id').nullable()
      table.decimal('amount', 12, 2).notNullable()
      table
        .enum('status', ['pending', 'held', 'processing', 'paid', 'failed', 'cancelled'])
        .notNullable()
        .defaultTo('pending')
      // Per-line snapshot taken at acceptance - see payout_calculation_service.ts.
      table.json('breakdown').notNullable()
      // delivered_at + the vendor's hold period; null until delivered.
      table.timestamp('eligible_at').nullable()
      table
        .enum('hold_reason', ['partial_refund', 'open_dispute', 'payout_method_invalid', 'manual'])
        .nullable()
      // Bumped each time a failed payout is re-queued - part of the provider
      // idempotency key, since a failed attempt's key can't be reused (PayPal
      // refuses a used sender_batch_id; Stripe replays the original error).
      table.integer('send_attempt').notNullable().defaultTo(1)
      table.text('failure_reason').nullable()
      table.enum('failure_kind', ['recipient', 'platform']).nullable()
      // When an admin last released this payout from a hold - refunds and
      // disputes up to then have been reviewed and don't hold it again.
      table.timestamp('released_at').nullable()
      table.timestamp('processing_at').nullable()
      table.timestamp('paid_at')
      table.timestamp('failed_at').nullable()
      table.timestamp('cancelled_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
