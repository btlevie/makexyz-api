import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'moderation_actions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // Append-only log of every human moderation decision and rule change -
      // who did what, to what, and why. Never updated or deleted.
      table
        .integer('actor_user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .integer('case_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('moderation_cases')
        .onDelete('SET NULL')
      table
        .enum('action', [
          'approve_message',
          'block_message',
          'remove_message',
          'restrict_user',
          'suspend_user',
          'lift_restriction',
          'rule_config_change',
          // Prohibited-item term list changes (moderation_terms).
          'term_added',
          'term_updated',
          'term_disabled',
          // URL allow/block/user-content list changes (url_domains).
          'domain_list_updated',
          // Moderator tooling (Step 7): a private warning email, closing a
          // conversation early, labelling a case for the discovery loop.
          'warn_user',
          'close_conversation',
          'label_case',
        ])
        .notNullable()
      // What was acted on: 'message' + uuid, 'customer'/'vendor' + uuid,
      // 'rule' + rule id.
      table.string('target_type', 40).notNullable()
      table.string('target_id', 80).notNullable()
      table.text('reason').nullable()
      // Before/after for config changes, tier and expiry for restrictions.
      table.json('metadata').nullable()

      table.timestamp('created_at')

      table.index(['target_type', 'target_id'])
      table.index(['case_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
