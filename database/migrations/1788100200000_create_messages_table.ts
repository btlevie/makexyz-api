import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'messages'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table
        .integer('conversation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('conversations')
        .onDelete('CASCADE')
      // Null for system messages.
      table
        .integer('sender_participant_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('conversation_participants')
        .onDelete('SET NULL')
      // The sender's principal, copied from the participant so behavioral
      // queries ("how many messages did this vendor send today") need no join.
      table
        .integer('sender_customer_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('customers')
        .onDelete('SET NULL')
      table
        .integer('sender_vendor_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('vendors')
        .onDelete('SET NULL')
      // Gap-free per conversation, assigned at insert under a row lock on the
      // conversation. Messages are ordered by this, never by timestamps.
      table.integer('seq').notNullable()
      // 'quote_ref' messages are written by the manual-quote flow and point at
      // a quote via ref_type/ref_id; system and quote_ref messages skip
      // content moderation.
      table.enum('kind', ['text', 'system', 'quote_ref']).notNullable().defaultTo('text')
      table.string('ref_type', 40).nullable()
      table.integer('ref_id').unsigned().nullable()
      table.enum('channel', ['web', 'email', 'system']).notNullable()
      // Sanitized plain text. Messages are never edited after sending.
      table.text('body').notNullable()
      // Client-generated idempotency key: a retried send returns the original.
      table.string('client_message_id', 64).nullable()
      // Every submission is kept, including blocked ones - the sender still
      // sees them (with the reason), and they're the raw material for
      // finding new abuse patterns. Recipients only ever see delivered
      // (or removed, as a tombstone).
      table
        .enum('status', [
          'held',
          'pending_review',
          'delivered',
          'delivered_flagged',
          'blocked',
          'removed',
          'withdrawn',
        ])
        .notNullable()
      table.string('block_reason_code', 80).nullable()
      table.string('user_facing_reason', 255).nullable()
      // sha256 of the normalized text - exact-duplicate detection.
      table.string('content_hash', 64).nullable()
      table.timestamp('delivered_at').nullable()
      table.timestamp('removed_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['conversation_id', 'seq'])
      table.unique(['sender_participant_id', 'client_message_id'])
      table.index(['content_hash', 'created_at'])
      table.index(['sender_customer_id', 'status', 'created_at'])
      table.index(['sender_vendor_id', 'status', 'created_at'])
      // Per-sender volume over a window, whatever the status (behavioral lookups).
      table.index(['sender_customer_id', 'created_at'])
      table.index(['sender_vendor_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
