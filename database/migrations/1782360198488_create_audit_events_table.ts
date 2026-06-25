import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'audit_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.enum('entity_type', ['order', 'project', 'quote', 'payment', 'refund', 'vendor_payout']).notNullable()
      table.integer('entity_id').unsigned().notNullable().index()
      table.enum('event_type', ['created', 'updated', 'deleted']).notNullable()
      table.json('payload').nullable()
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL')


      table.timestamp('created_at')
      table.timestamp('updated_at')
      table.index(['entity_type', 'entity_id'], 'entity_type_entity_id_index')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}