import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'url_domains'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // A host suffix: a registrable domain ("example.com") or a more specific
      // host ("drive.google.com"). A link matches the most specific row whose
      // domain is its host or a parent of it.
      table.string('domain', 253).unique().notNullable()
      // Moderator override of the built-in lists in
      // app/services/moderation/url/domain_lists.ts. Null = no override (the
      // row only carries the stats below).
      // allow: lifts the "unknown link" hold. block: always blocked.
      // user_content: file sharing/hosting - always checked per URL, never
      // auto-allowed. none: explicitly on no list (overrides a built-in).
      table.enum('list_status', ['allow', 'block', 'user_content', 'none']).nullable()
      table.text('note').nullable()
      table
        .integer('updated_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      // Domain age from RDAP - young domains are a strong phishing signal.
      table.timestamp('registered_at').nullable()
      table.timestamp('rdap_checked_at').nullable()
      // How widely the domain has been seen in messages.
      table.timestamp('first_seen_at').nullable()
      table.timestamp('last_seen_at').nullable()
      table.integer('seen_count').notNullable().defaultTo(0)

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
