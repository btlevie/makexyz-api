import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'quote_items'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Which pricing configuration produced this line, and the full calculation
      // breakdown it produced. Together these answer "why did this customer get
      // this price?" months later, after the active configuration has moved on.
      // The snapshot holds unrounded values; unit_price/total are the rounded
      // monetary columns.
      table
        .integer('pricing_config_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('pricing_configs')
        .onDelete('SET NULL')
      table.jsonb('pricing_snapshot').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('pricing_config_id')
      table.dropColumn('pricing_snapshot')
    })
  }
}
