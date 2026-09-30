import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'messaging_risk_profiles'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // Exactly one principal: a customer or a vendor. Admins are exempt.
      table
        .integer('customer_id')
        .unsigned()
        .nullable()
        .unique()
        .references('id')
        .inTable('customers')
        .onDelete('CASCADE')
      table
        .integer('vendor_id')
        .unsigned()
        .nullable()
        .unique()
        .references('id')
        .inTable('vendors')
        .onDelete('CASCADE')
      // Messaging only - never restricts ordering, quoting or fulfilment.
      // 'restricted': every message goes to human review. 'suspended': can't
      // send (except in a thread with a live order, where it's treated as
      // restricted so fulfilment isn't stranded). Suspension is always a
      // human decision.
      table
        .enum('trust_tier', ['new', 'standard', 'trusted', 'restricted', 'suspended'])
        .notNullable()
        .defaultTo('new')
      table.timestamp('restriction_expires_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
