import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'webhook_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.enum('provider', ['stripe', 'paypal', 'easypost']).notNullable()
      // The provider's own event id - together with `provider`, this is the
      // idempotency key. Every provider retries delivery on anything but a
      // prompt 2xx, and can occasionally redeliver the same event regardless.
      table.string('event_id').notNullable()
      table.string('event_type').notNullable()
      table.timestamp('processed_at').notNullable()

      table.unique(['provider', 'event_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
