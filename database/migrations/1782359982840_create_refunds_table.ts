import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'refunds'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('payment_id').unsigned().references('id').inTable('payments').onDelete('CASCADE')
      table.decimal('amount', 12, 2).notNullable()
      table.text('reason').nullable()
      table.enum('provider', ['stripe', 'paypal']).notNullable()
      // The refund's own id from the provider - for correlation/support
      // lookups. Separate from webhook_events, which guards against
      // reprocessing the same webhook delivery rather than identifying the
      // refund itself.
      table.string('provider_refund_id').notNullable()
      // Only confirmed refunds reach us today (see webhook handling in
      // refund_service.ts), so 'succeeded' is the default rather than
      // 'pending'.
      table.enum('status', ['pending', 'succeeded', 'failed']).notNullable().defaultTo('succeeded')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}