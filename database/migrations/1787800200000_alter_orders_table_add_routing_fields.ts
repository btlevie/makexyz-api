import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // 'unfulfillable' - a defensive safety net: normally caught much
      // earlier at the quote-review stage (see quote_generation_service.ts),
      // but a vendor's capabilities could in principle change between quote-
      // accept and order-routing. Tags the order visible/queryable instead
      // of silently sitting in 'open' forever with no vendor able to accept it.
      table.enum('routing_stage', ['preferred', 'open', 'unfulfillable']).nullable()
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
