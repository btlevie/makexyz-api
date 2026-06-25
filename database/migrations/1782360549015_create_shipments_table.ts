import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'shipments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('order_id').unsigned().references('id').inTable('orders').onDelete('CASCADE')
      table.integer('vendor_id').unsigned().references('id').inTable('vendors').onDelete('CASCADE')
      table.integer('address_id').unsigned().references('id').inTable('addresses').onDelete('CASCADE')
      table.string('carrier').notNullable()
      table.string('service_level')
      table.string('tracking_number').nullable()
      table.enum('status', ['pending', 'label_created', 'shipped', 'in_transit', 'delivered', 'cancelled']).notNullable().defaultTo('pending')
      table.timestamp('label_created_at')
      table.timestamp('shipped_at')
      table.timestamp('in_transit_at')
      table.timestamp('delivered_at')
      table.timestamp('cancelled_at')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}