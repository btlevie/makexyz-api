import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'messaging_risk_profiles'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // Exactly one principal: a customer or a vendor. Admins are exempt.
      table
        .integer('customer_id')
        .unsigned()
        .nullable()
        .unique()
        .references('id')
        .inTable('customers')
        .onDelete('CASCADE')
      table
        .integer('vendor_id')
        .unsigned()
        .nullable()
        .unique()
        .references('id')
        .inTable('vendors')
        .onDelete('CASCADE')
      // Messaging only - never restricts ordering, quoting or fulfilment.
      // 'restricted': every message goes to human review. 'suspended': can't
      // send (except in a thread with a live order, where it's treated as
      // restricted so fulfilment isn't stranded). Suspension is always a
      // human decision.
      table
        .enum('trust_tier', ['new', 'standard', 'trusted', 'restricted', 'suspended'])
        .notNullable()
        .defaultTo('new')
      table.timestamp('restriction_expires_at').nullable()
      // 'manual': a moderator set the tier (restricted/suspended), so automatic
      // promotion leaves it alone until it expires. 'auto': computed by
      // messaging_risk_service.ts#refreshRiskProfile.
      table.enum('tier_source', ['auto', 'manual']).notNullable().defaultTo('auto')
      // A temporary automatic hold (repeated blocked attempts, several vendors
      // blocking the same customer): everything goes to review until then.
      // Not a suspension - it expires on its own.
      table.timestamp('hold_until').nullable()
      table.string('hold_reason', 60).nullable()
      // When the last automatic restriction was applied, so the same
      // violations don't restrict the sender again after it expires.
      table.timestamp('auto_restricted_at').nullable()
      // Cached counters over the last 30 days (delivered: all time), recomputed
      // hourly and on human decisions - the send-time rules read these
      // instead of counting.
      table.integer('delivered_messages').notNullable().defaultTo(0)
      // Messages a moderator blocked or removed in the last 30 days. Automatic
      // blocks never count - only a human upholding one does.
      table.integer('confirmed_violations').notNullable().defaultTo(0)
      table.integer('reports_received').notNullable().defaultTo(0)
      // Customers only: distinct vendors who blocked them in the last 30 days.
      table.integer('vendor_blocks').notNullable().defaultTo(0)
      // The sender's own hourly volume over the last 7 days - the baseline
      // the volume-anomaly check compares the current hour against.
      table.float('hourly_mean').notNullable().defaultTo(0)
      table.float('hourly_stddev').notNullable().defaultTo(0)
      table.timestamp('computed_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
