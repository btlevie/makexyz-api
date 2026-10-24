import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'message_urls'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('message_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('messages')
        .onDelete('CASCADE')
      // Joins to url_scans.url_hash. Lets a URL that turns malicious later be
      // traced to every message containing it (RescanRecentUrls).
      table.string('url_hash', 64).notNullable()
      table.text('normalized_url').notNullable()
      table.string('domain', 253).notNullable()
      // eTLD+1 of `domain` (null for IP hosts) - what spread and clustering count by.
      table.string('registrable_domain', 253).nullable()
      // The text as written, so clients can swap it for the interstitial link.
      table.text('match').notNullable()
      // 'text': in the message body. 'attachment': a QR code or PDF link.
      table.enum('source', ['text', 'attachment']).notNullable().defaultTo('text')
      // Public handle for the click-through interstitial (/v1/links/:token) -
      // links are never handed out raw, so a later takedown still works.
      table.uuid('token').unique().notNullable()

      table.timestamp('created_at')

      table.index(['url_hash'])
      table.index(['message_id'])
      // How many senders shared a domain recently (url.domain_spread, clustering).
      table.index(['registrable_domain', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
