import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'quotes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Shipping, tax, and production time live on the quote (not the
      // checkout session) so a customer sees the full price - including
      // shipping and rush cost - before accepting, not first at a separate
      // checkout step. All nullable: the auto-generated instant-quote path
      // has no address yet at creation time, so these only get populated once
      // the customer configures the quote (see quotes_controller#configure).
      table.string('destination_country', 2).nullable()
      table
        .enum('shipping_method', ['free', 'ups_2day', 'ups_overnight', 'international_expedited'])
        .nullable()
      table.decimal('shipping_fee_amount', 12, 2).nullable()
      // Integer business-day count, not a named tier enum - matches
      // production_time_tiers.business_days and the exponential fee formula,
      // which is entirely day-count-driven. Defaults to the active
      // production-time config's standard day count at creation time (see
      // quote_generation_service#persistQuote), so this is populated from the
      // start even before the customer has chosen anything.
      table.integer('production_time_business_days').nullable()
      table.decimal('production_time_fee_amount', 12, 2).nullable()
      // Stripe Tax calculation id backing the current `tax` value - an
      // estimate until finalized (stripe.tax.transactions.createFromCalculation)
      // at capture time, once a vendor accepts the order.
      table.string('stripe_tax_calculation_id').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('destination_country')
      table.dropColumn('shipping_method')
      table.dropColumn('shipping_fee_amount')
      table.dropColumn('production_time_business_days')
      table.dropColumn('production_time_fee_amount')
      table.dropColumn('stripe_tax_calculation_id')
    })
  }
}
