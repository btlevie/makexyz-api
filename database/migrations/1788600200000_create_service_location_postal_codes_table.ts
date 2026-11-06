import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'service_location_postal_codes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('service_location_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('service_locations')
        .onDelete('CASCADE')
      // Which city page a searched address or postal code belongs to. Seeded
      // from vendors' own business addresses and legacy city pages, and
      // learned from reverse geocodes of searches.
      table.string('country', 2).notNullable()
      table.string('postal_code', 20).notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['country', 'postal_code'])
      table.index(['service_location_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
