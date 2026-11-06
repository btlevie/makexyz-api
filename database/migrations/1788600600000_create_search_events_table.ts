import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'search_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // Every directory search, so places with real demand can become city
      // pages (docs/plans/manual_quotes.md, 2g). Written best effort.
      table.string('raw_query', 255).nullable()
      // What the customer picked (a city, address or postal code), and the
      // city it's in - the key candidates are grouped by.
      table.string('place_id', 255).nullable()
      table.string('locality_place_id', 255).nullable()
      table.string('city').nullable()
      table.string('state').nullable()
      table.string('country', 2).nullable()
      table.string('postal_code', 20).nullable()
      // Rounded to 2 decimal places (about 1 km) and nulled after 30 days
      // (PurgeSearchEventCoordinates), in keeping with Google's caching limit.
      table.double('lat').nullable()
      table.double('lng').nullable()
      // The city page the search resolved to; null = no page for that place.
      table
        .integer('matched_location_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('service_locations')
        .onDelete('SET NULL')
      // The nearest indexable city page within 50 miles, when it differs.
      table
        .integer('canonical_location_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('service_locations')
        .onDelete('SET NULL')
      table.string('service', 20).nullable()
      table.json('filters').nullable()
      table.integer('result_count').notNullable().defaultTo(0)
      table.string('session_key', 64).nullable()
      table
        .integer('customer_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('customers')
        .onDelete('SET NULL')

      table.timestamp('created_at')

      table.index(['created_at'])
      table.index(['matched_location_id'])
      table.index(['canonical_location_id'])
      table.index(['session_key'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
