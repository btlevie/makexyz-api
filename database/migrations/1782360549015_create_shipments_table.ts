import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'shipments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('order_id').unsigned().references('id').inTable('orders').onDelete('CASCADE')
      table.integer('vendor_id').unsigned().references('id').inTable('vendors').onDelete('CASCADE')
      // Ship-to address. No onDelete - address_service#deleteAddress refuses to
      // delete an address a shipment references, so shipment history can't be
      // silently cascaded away.
      table.integer('address_id').unsigned().references('id').inTable('addresses')
      // Nullable: the row is inserted as 'pending' before the label is bought
      // (see shipment_service.ts), and carrier/service are only known after.
      table.string('carrier').nullable()
      table.string('service_level')
      table.string('tracking_number').nullable()
      table.string('tracking_url').nullable()
      // Raw EasyPost tracker status (pre_transit, in_transit, delivered,
      // return_to_sender, ...) - finer-grained than `status`, kept so stuck or
      // failed deliveries can be queried.
      table.string('tracker_status').nullable()
      table.string('easypost_shipment_id').nullable().unique()
      // Lease held while one request is buying this shipment's label, so a
      // concurrent request can't buy a second one. Cleared when that request
      // finishes; a stale lease (crashed process) expires - see
      // shipment_service.ts.
      table.timestamp('label_purchase_started_at').nullable()
      table.decimal('weight_oz', 10, 2).notNullable()
      table.decimal('length_in', 10, 2).notNullable()
      table.decimal('width_in', 10, 2).notNullable()
      table.decimal('height_in', 10, 2).notNullable()
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