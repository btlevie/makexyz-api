import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'moderation_evaluations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('message_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('messages')
        .onDelete('CASCADE')
      // One row per pipeline pass on a message: the synchronous pass at send,
      // then any later async analysis or rescan.
      table.enum('stage', ['sync', 'async', 'rescan']).notNullable()
      table.string('pipeline_version', 40).notNullable()
      table.enum('decision', ['allow', 'flag', 'escalate', 'review', 'hold', 'block']).notNullable()
      table.float('risk_score').notNullable().defaultTo(0)
      // What the extractors found (emails, phones, URLs with their domains) -
      // what the rules saw, kept for explainability and rule replay.
      table.json('signals').nullable()
      // Every `rule@version` that ran, fired or not - answers "which rules
      // were checked and didn't fire?" without a row per rule per message.
      table.json('rules_evaluated').nullable()
      table.json('llm').nullable()
      table.integer('duration_ms').notNullable().defaultTo(0)

      table.timestamp('created_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
