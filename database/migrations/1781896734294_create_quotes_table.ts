import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'quotes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('project_id').unsigned().references('id').inTable('projects').onDelete('SET NULL')
      table.integer('created_by_id').unsigned().references('id').inTable('users').onDelete('SET NULL')
      table.integer('revision').notNullable()
      table.decimal('subtotal', 12, 2).notNullable()
      table.decimal('tax', 12, 2).notNullable()
      table.decimal('total', 12, 2).notNullable()
      // 'needs_review' - persisted once, at auto-quote creation, when the
      // quote can't proceed as-is (e.g. its items span technologies no
      // single vendor covers) - blocks accept, but configure may still run
      // to capture the customer's choices (see quote_generation_service.ts).
      table
        .enum('status', ['draft', 'sent', 'accepted', 'rejected', 'needs_review'])
        .notNullable()
        .defaultTo('draft')
      // Status is the outcome; this is the cause. Kept separate so lost deals
      // can be split by reason - 'abandoned' (expired without checkout) reads
      // very differently from 'declined' (actively said no), even though both
      // are rejections.
      table.enum('rejection_reason', ['abandoned', 'declined']).nullable()
      table.timestamp('rejected_at').nullable()
      // Why a quote needs review - plain string, not an enum, so a future
      // second trigger reason is just a new application-level value, not a
      // migration. Deliberately separate from rejection_reason: this quote
      // isn't rejected, it's paused pending resolution.
      table.string('review_reason').nullable()
      table.text('notes').nullable()
      table.enum('generated_by', ['system', 'user']).notNullable().defaultTo('system')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}