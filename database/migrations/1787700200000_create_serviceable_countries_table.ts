import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'serviceable_countries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      // ISO 3166-1 alpha-2, e.g. 'US' - the primary key, not a surrogate id:
      // there is exactly one row per country and nothing else references this
      // table by a numeric id.
      table.string('country_code', 2).primary()
      table.string('country_name').notNullable()
      table.boolean('is_active').notNullable().defaultTo(true)

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
