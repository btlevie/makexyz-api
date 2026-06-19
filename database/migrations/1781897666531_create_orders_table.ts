import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('quote_id').unsigned().references('id').inTable('quotes').onDelete('SET NULL')
      table.integer('vendor_id').unsigned().references('id').inTable('vendors').onDelete('SET NULL')
      table.integer('customer_id').unsigned().references('id').inTable('customers').onDelete('SET NULL')
      table.integer('project_id').unsigned().references('id').inTable('projects').onDelete('SET NULL')
      table.string('external_reference').nullable()
      table.string('order_number').notNullable()
      table.decimal('subtotal', 12, 2).notNullable()
      table.decimal('tax', 12, 2).notNullable()
      table.decimal('total', 12, 2).notNullable()
      table.enum('status', ['pending', 'paid', 'open', 'accepted', 'rejected', 'in_progress', 'ready_to_ship', 'shipped', 'delivered', 'refunded', 'cancelled']).notNullable().defaultTo('pending')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}