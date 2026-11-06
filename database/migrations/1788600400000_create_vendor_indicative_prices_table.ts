import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vendor_indicative_prices'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('vendor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('vendors')
        .onDelete('CASCADE')
      table
        .integer('material_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('materials')
        .onDelete('CASCADE')
      // What the vendor publishes for the "$ to $$$$" price indicator. Not
      // binding: manual quotes are freeform.
      table.decimal('price_per_cubic_cm', 10, 4).notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['vendor_id', 'material_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
