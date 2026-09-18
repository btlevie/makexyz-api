import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'production_time_tiers'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('production_time_config_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('production_time_configs')
        .onDelete('CASCADE')
      // The selectable turnaround options themselves are data, not an enum -
      // this is what lets a new tier (e.g. same-day) get added without a
      // schema change. The standard/default tier is a row here too
      // (business_days === standardBusinessDays on the parent config), not a
      // special case - its fee is simply 0 because daysSaved works out to 0.
      table.integer('business_days').notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['production_time_config_id', 'business_days'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
