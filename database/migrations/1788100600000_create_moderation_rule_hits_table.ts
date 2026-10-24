import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'moderation_rule_hits'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('evaluation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('moderation_evaluations')
        .onDelete('CASCADE')
      table
        .integer('message_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('messages')
        .onDelete('CASCADE')
      // Only rules that fired get a row - makes "messages where rule X fired"
      // and per-rule precision a plain indexed query.
      table.string('rule_id', 80).notNullable()
      table.integer('rule_version').notNullable()
      table.integer('config_version').notNullable()
      table
        .enum('action', [
          'block',
          'hold',
          'review',
          'escalate',
          'flag',
          'allow_override',
          'continue',
          'redact',
        ])
        .notNullable()
      table.float('weight').notNullable().defaultTo(0)
      // A shadow-mode hit: recorded, but it didn't affect the decision.
      table.boolean('shadow').notNullable().defaultTo(false)
      // The matched spans, so a moderator sees exactly what fired.
      table.json('evidence').nullable()

      table.timestamp('created_at')

      table.index(['rule_id', 'created_at'])
      table.index(['message_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
