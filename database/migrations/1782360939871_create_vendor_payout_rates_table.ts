import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vendor_payout_rates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('vendor_id').unsigned().references('id').inTable('vendors').onDelete('CASCADE')
      table.integer('material_id').unsigned().references('id').inTable('materials').onDelete('CASCADE')
      table.decimal('percentage', 5, 2).notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}