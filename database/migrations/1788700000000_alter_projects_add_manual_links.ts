import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Links a manual project to the inquiry it came from, and a project file to
 * the message attachment it was copied from (docs/plans/manual_quotes.md,
 * section 3). An alter rather than part of the create migrations because
 * conversations and message_attachments are created after projects and
 * project_files (and conversations already references projects).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('projects', (table) => {
      // The inquiry thread a manual project was started from. One inquiry can
      // lead to several projects over time (repeat work); this is their
      // history, while conversations.project_id points at the latest.
      table
        .integer('conversation_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('conversations')
        .onDelete('SET NULL')
      table.index(['conversation_id'])
    })

    this.schema.alterTable('project_files', (table) => {
      // The scanned attachment a file was copied from - provenance, and what
      // stops the same attachment being copied into a project twice.
      table
        .integer('message_attachment_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('message_attachments')
        .onDelete('SET NULL')
      table.unique(['project_id', 'message_attachment_id'])
    })
  }

  async down() {
    this.schema.alterTable('project_files', (table) => {
      table.dropUnique(['project_id', 'message_attachment_id'])
      table.dropColumn('message_attachment_id')
    })
    this.schema.alterTable('projects', (table) => {
      table.dropIndex(['conversation_id'])
      table.dropColumn('conversation_id')
    })
  }
}
