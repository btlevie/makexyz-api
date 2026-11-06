import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'place_coordinates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // A Google place ID in use by a vendor or a city page. One row per city,
      // shared by every vendor there and by the city's page, so refreshes
      // scale with distinct cities, not vendors (geocoding_service.ts).
      table.string('place_id', 255).notNullable().unique()
      // Google lets coordinates be cached for at most 30 days; expires_at is
      // never more than that after refreshed_at. RefreshPlaceCoordinates
      // re-fetches rows before they expire. An expired row is ignored, and
      // vendors there rank on reputation alone until the next refresh.
      table.double('lat').notNullable()
      table.double('lng').notNullable()
      table.timestamp('refreshed_at').notNullable()
      table.timestamp('expires_at').notNullable().index()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
