import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'moderation_rule_configs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // A rule's stable slug, e.g. 'contact.email'. Rules without a row run
      // with their code defaults (see app/services/moderation/rule_registry.ts).
      table.string('rule_id', 80).notNullable().unique()
      // 'shadow': runs and records its hits, but never affects the decision -
      // how every new rule is measured before it's trusted.
      table.enum('mode', ['off', 'shadow', 'enforce']).notNullable()
      // Overrides merged over the rule's defaultConfig.
      table.json('config').nullable()
      // Bumped on every change and recorded with each rule hit, so any past
      // decision can be explained against the config that produced it.
      table.integer('config_version').notNullable().defaultTo(1)
      table
        .integer('updated_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
