import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Mirrors the same-named columns on quotes 1:1 - copied from the
      // accepted quote at order creation as the permanent immutable record,
      // same pattern as QuoteItem -> OrderItem. Not modeled via the generic
      // fees/order_fees catalog - that exists for arbitrary fees manually
      // attached to a quote/order, not these two structured, code-computed
      // charges.
      table
        .enum('shipping_method', ['free', 'ups_2day', 'ups_overnight', 'international_expedited'])
        .nullable()
      table.decimal('shipping_fee_amount', 12, 2).nullable()
      table.integer('production_time_business_days').nullable()
      table.decimal('production_time_fee_amount', 12, 2).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('shipping_method')
      table.dropColumn('shipping_fee_amount')
      table.dropColumn('production_time_business_days')
      table.dropColumn('production_time_fee_amount')
    })
  }
}
