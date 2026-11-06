import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'service_locations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // A city page ("3D printers in Austin") - service_location_service.ts.
      // Stored by the city's Google place ID plus its postal codes
      // (service_location_postal_codes), never by coordinates.
      table.string('slug', 120).notNullable().unique()
      table.string('city').notNullable()
      table.string('state').nullable()
      table.string('country', 2).notNullable()
      // Null only for an imported page not yet geocoded.
      table.string('place_id', 255).nullable().unique()
      table.timestamp('place_id_refreshed_at').nullable()

      // Set by the city-page scoring job (docs/plans/manual_quotes.md, 2g).
      // A page that isn't indexable is served noindex and left out of
      // GET /v1/locations.
      table.boolean('is_indexable').notNullable().defaultTo(false)
      // Active vendors within 25 miles (the supply test).
      table.integer('nearby_vendor_count').notNullable().defaultTo(0)
      table.integer('search_demand').notNullable().defaultTo(0)
      table.integer('recent_orders').notNullable().defaultTo(0)
      // Up to 15 nearby non-indexable towns, shown as "Serving: ...".
      table.json('served_area_names').nullable()
      table.timestamp('scored_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index(['country', 'state', 'city'])
      table.index(['is_indexable'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
