import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conversation_blocks'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // A vendor permanently blocking a customer from sending them inquiries.
      table
        .integer('vendor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('vendors')
        .onDelete('CASCADE')
      table
        .integer('customer_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('customers')
        .onDelete('CASCADE')
      table
        .integer('created_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('reason', 500).nullable()
      // Blocking also opens a moderation case, so staff see the pattern when
      // several vendors block the same customer.
      table
        .integer('case_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('moderation_cases')
        .onDelete('SET NULL')

      table.timestamp('created_at')

      table.unique(['vendor_id', 'customer_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
