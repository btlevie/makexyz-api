import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'addresses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.enum('owner_type', ['customer', 'vendor']).notNullable()
      table.integer('customer_id').unsigned().references('id').inTable('customers').onDelete('SET NULL')
      table.integer('vendor_id').unsigned().references('id').inTable('vendors').onDelete('SET NULL')
      table.string('label').nullable()
      table.string('recipient_name').notNullable()
      table.string('line_1').notNullable()
      table.string('line_2').nullable()
      table.string('city').notNullable()
      table.string('state').nullable()
      table.string('postal_code').notNullable()
      table.string('country').notNullable()
      // One default address per owner (customer or vendor), enforced in
      // app/services/address_service.ts (unsetting any prior default before
      // setting a new one) rather than a DB constraint.
      table.boolean('is_default').notNullable().defaultTo(false)

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}