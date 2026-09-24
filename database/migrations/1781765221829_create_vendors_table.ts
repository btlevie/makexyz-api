import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vendors'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL')
      // Which rail payouts are sent on - see vendor_payout_method_service.ts.
      table.enum('payout_provider', ['stripe', 'paypal']).nullable()
      // The vendor's Stripe Connect (Express) account, `acct_...`. Only ever
      // created and stored server-side during onboarding - never vendor input.
      table.string('stripe_account_id').nullable().unique()
      // Cached from the Connect account's payouts_enabled.
      table.boolean('stripe_payouts_enabled').notNullable().defaultTo(false)
      // Verified PayPal account id from Log in with PayPal - payouts are sent
      // to this (recipient_type PAYPAL_ID), never to a typed email.
      table.string('paypal_payer_id').nullable().unique()
      // Display only, from PayPal's userinfo.
      table.string('paypal_email').nullable()
      // Set when a payout fails because of the vendor's own account (closed,
      // limited, unclaimed); cleared when they reconnect.
      table.string('payout_method_error').nullable()
      table.timestamp('payout_method_error_at').nullable()
      // Days after delivery before a payout is sent; null = the default.
      table.integer('payout_hold_days').nullable()
      table.string('quickbooks_vendor_id').nullable()
      table.string('display_name').nullable()
      table.string('tax_status').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
