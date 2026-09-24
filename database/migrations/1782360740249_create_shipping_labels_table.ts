import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'shipping_labels'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('shipment_id').unsigned().references('id').inTable('shipments').onDelete('CASCADE')
      table.enum('provider', ['easypost']).notNullable()
      table.string('provider_rate_id').nullable()
      table.string('label_format').nullable()
      table.string('label_url').nullable()
      table.string('label_pdf_url').nullable()
      table.decimal('cost', 12, 2).notNullable()
      table.timestamp('voided_at')
      // EasyPost label refunds are asynchronous - 'submitted' until the
      // carrier confirms or rejects.
      table.enum('refund_status', ['submitted', 'refunded', 'rejected']).nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}