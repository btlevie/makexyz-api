import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'moderation_pattern_reports'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      // The weekly DiscoverAbusePatterns run: violations the rules missed or
      // a moderator confirmed in this window, grouped into clusters for an
      // engineer to turn into rules. Read-only output - it never changes rules.
      table.timestamp('period_start').notNullable()
      table.timestamp('period_end').notNullable()
      // How many labelled violations went in, and how many the rules missed.
      table.integer('violations').notNullable().defaultTo(0)
      table.integer('missed_by_automation').notNullable().defaultTo(0)
      // [{ kind, key, size, messageUuids, examples, ... }] - see
      // abuse_pattern_service.ts.
      table.json('clusters').nullable()
      // Optional LLM summaries per cluster (pattern, proposed rule, phrases).
      table.json('summaries').nullable()

      table.timestamp('created_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
