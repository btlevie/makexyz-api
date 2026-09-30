import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conversation_participants'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('conversation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('conversations')
        .onDelete('CASCADE')
      table.enum('role', ['customer', 'vendor', 'staff']).notNullable()
      // Exactly one principal per role: customer_id for a customer (which may
      // still be a guest - they must claim an account to read or reply),
      // vendor_id for a vendor, user_id for staff.
      table
        .integer('customer_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('customers')
        .onDelete('SET NULL')
      table
        .integer('vendor_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('vendors')
        .onDelete('SET NULL')
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      // What the other side sees - never an email address. A white-label
      // instant-quote vendor is "Your manufacturer"; customers are
      // "First L.".
      table.string('display_name', 120).notNullable()
      // Reserved for reply-by-email (a per-participant alias token); unused
      // until that ships.
      table.string('reply_token', 64).nullable().unique()
      table.timestamp('reply_token_expires_at').nullable()
      table.integer('last_read_seq').notNullable().defaultTo(0)
      table.integer('last_notified_seq').notNullable().defaultTo(0)
      table.boolean('email_notifications').notNullable().defaultTo(true)
      table.timestamp('removed_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      // No composite unique here - the principal columns are mostly null, and
      // null never collides. Participants are only ever created alongside
      // their conversation (conversation_service.ts), which owns uniqueness.
      table.index(['conversation_id', 'role'])
      table.index(['customer_id'])
      table.index(['vendor_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
