import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.enum('routing_stage', ['preferred', 'open']).nullable()
      // Nullable - null when an order skips straight to 'open' (no preferred
      // vendor covers its required technologies), since there's nothing to
      // expire from.
      table.timestamp('routing_expires_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('routing_stage')
      table.dropColumn('routing_expires_at')
    })
  }
}
