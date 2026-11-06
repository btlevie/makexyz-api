import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'landing_page_visits'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // A visitor landing on a page (recorded by the frontend) - the second
      // first-party demand signal for city-page scoring, covering visitors
      // who arrive from outside and never use the search box.
      table.string('path', 512).notNullable()
      table.string('referrer', 512).nullable()
      table.boolean('is_internal_referrer').notNullable().defaultTo(false)
      table.string('session_key', 64).nullable()

      table.timestamp('created_at')

      table.index(['path', 'created_at'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
