import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'shipping_labels'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('shipment_id').unsigned().references('id').inTable('shipments').onDelete('CASCADE')
      table.string('provider').notNullable()
      table.string('label_url').nullable()
      table.string('label_pdf_url').nullable()
      table.decimal('cost', 12, 2).notNullable()
      table.timestamp('voided_at')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}