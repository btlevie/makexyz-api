import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'url_scans'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // sha256 of the normalized URL - one analysis per URL per TTL, however
      // many messages contain it.
      table.string('url_hash', 64).unique().notNullable()
      table.text('normalized_url').notNullable()
      table.string('domain', 253).notNullable()
      // malicious: Web Risk threat, or a redirect to a private address.
      // unknown: no reputation available (no API key, lookup failed).
      table.enum('verdict', ['safe', 'malicious', 'unknown']).notNullable()
      table.json('threat_types').nullable()
      // Where the redirects ended, and every hop on the way.
      table.text('final_url').nullable()
      table.string('final_domain', 253).nullable()
      table.json('redirect_chain').nullable()
      // Why the verdict is what it is ("web_risk", "redirect_private_ip",
      // "web_risk_unavailable"...), for moderators.
      table.json('details').nullable()
      table.timestamp('checked_at').notNullable()
      table.timestamp('expires_at').notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index(['expires_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
