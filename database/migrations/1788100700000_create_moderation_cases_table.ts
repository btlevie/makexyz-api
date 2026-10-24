import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'moderation_cases'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table
        .integer('message_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('messages')
        .onDelete('SET NULL')
      // The subject whose behavior is under review - one of these.
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
        .enum('source', [
          'auto_hold',
          'auto_flag',
          'report',
          'behavioral',
          'audit_sample',
          'url_rescan',
          'quote_outlier',
          'unconfirmed_delivery',
          'prohibited_item',
        ])
        .notNullable()
      // Lower is more urgent. A held message (someone is waiting) sorts first.
      table.integer('priority').notNullable().defaultTo(50)
      table.enum('status', ['open', 'claimed', 'resolved']).notNullable().defaultTo('open')
      table
        .integer('assigned_to_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('claimed_at').nullable()
      table.enum('resolution', ['approved', 'blocked', 'removed', 'no_action']).nullable()
      // The label moderators give a case - what the abuse-pattern discovery
      // loop learns from.
      table.string('abuse_category', 60).nullable()
      table.text('pattern_note').nullable()
      table.boolean('missed_by_automation').notNullable().defaultTo(false)
      // What a behavioral case is about, for the moderator: the blocked
      // messages behind an auto-hold, the accounts in a cluster, the volume
      // spike. Null for message cases.
      table.json('details').nullable()
      // One open case per pattern: a detector skips opening a case whose key
      // already has an unresolved one (e.g. 'cluster:domain:example.top').
      table.string('dedup_key', 160).nullable()
      table
        .integer('resolved_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('resolved_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index(['status', 'priority', 'created_at'])
      table.index(['message_id'])
      table.index(['dedup_key', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
