import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'moderation_terms'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      // Admin changes to the prohibited-item word lists. The built-in lists
      // live in code (app/services/moderation/prohibited_terms.ts); a row for
      // a term not in them is an addition, a row for a built-in term
      // overrides it (new action, disabled, a note). See term_registry.ts.
      table
        .enum('category', ['firearm', 'weapon', 'drugs', 'counterfeit_fraud', 'context_allow'])
        .notNullable()
      // Normalized like message text: NFKC, look-alikes folded, lowercased,
      // whitespace collapsed - so it matches the pipeline's text views.
      table.string('term', 60).notNullable()
      // block: block + prohibited-item case. review: hold for a person.
      // weight: risk-score weight only. Null for context_allow words.
      table.enum('action', ['block', 'review', 'weight']).nullable()
      // shadow: matches are recorded but don't affect delivery. Never deleted -
      // a retired term is disabled, so past hits stay explainable.
      table.enum('status', ['active', 'shadow', 'disabled']).notNullable().defaultTo('active')
      table.text('note').nullable()
      table
        .integer('created_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .integer('updated_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['category', 'term'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
