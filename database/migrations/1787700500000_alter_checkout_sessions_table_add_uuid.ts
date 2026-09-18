import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'checkout_sessions'

  async up() {
    // Missing from the original migration - every other domain table has
    // both an auto-increment id (internal FKs) and a public-facing uuid
    // (route params, transformers). Needed now that checkout sessions are
    // referenced directly from a route (PATCH .../checkout-sessions/:uuid).
    // Nothing in production yet and no rows exist ahead of this feature, so
    // this adds it directly as notNullable/unique rather than a
    // nullable-then-backfill dance - same "nothing to preserve yet"
    // simplification as alter_project_files_table_add_sls.ts.
    this.schema.alterTable(this.tableName, (table) => {
      table.uuid('uuid').notNullable().unique()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('uuid')
    })
  }
}
