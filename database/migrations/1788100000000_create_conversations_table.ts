import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conversations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      // Every conversation exists because of something else - there's no
      // user-to-user DM. 'inquiry': a verified customer writing to a vendor
      // (may later gain a manual project/order, see
      // docs/plans/manual_quotes.md). 'order': an instant-quote order's
      // customer and its accepted vendor. 'support': a user and MakeXYZ staff.
      table.enum('kind', ['inquiry', 'order', 'support']).notNullable()
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
        .integer('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')
      table
        .integer('order_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('orders')
        .onDelete('SET NULL')
      table.string('subject', 200).nullable()
      table.enum('status', ['open', 'read_only', 'archived']).notNullable().defaultTo('open')
      // Why it stopped accepting messages - status is the outcome, this the cause.
      table
        .enum('closed_reason', [
          'idle',
          'declined',
          'blocked',
          'order_closed',
          'reassigned',
          'staff',
        ])
        .nullable()
      table.timestamp('read_only_at').nullable()
      // Per-conversation message sequence - incremented under a row lock on
      // this conversation whenever a message is inserted (message_service.ts),
      // which is what makes `messages.seq` gap-free and totally ordered.
      table.integer('last_seq').notNullable().defaultTo(0)
      table.timestamp('last_message_at').nullable()
      // Inquiries only appear to the vendor once the customer's first message
      // has actually been delivered (a blocked or held opener shows nothing).
      // Both timestamps also back the vendor response rate/time stats.
      table.timestamp('first_customer_message_delivered_at').nullable()
      table.timestamp('first_vendor_response_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      // One thread per (order, assigned vendor): a reassigned order gets a
      // fresh thread for the new vendor rather than exposing the old one.
      table.unique(['order_id', 'vendor_id'])
      table.index(['customer_id', 'kind', 'created_at'])
      table.index(['vendor_id', 'kind', 'status'])
      table.index(['status', 'last_message_at'])
    })

    // At most one open inquiry per (customer, vendor) - follow-ups go on the
    // same thread. A partial index so closed inquiries don't block a new one.
    this.schema.alterTable(this.tableName, (table) => {
      table.unique(['customer_id', 'vendor_id'], {
        indexName: 'conversations_one_open_inquiry_per_pair',
        predicate: this.knex().whereRaw("kind = 'inquiry' and status = 'open'"),
      })
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
