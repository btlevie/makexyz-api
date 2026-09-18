import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'order_routing_configs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('name').notNullable()
      table.integer('version').notNullable()
      // Exactly one active row at a time - same pattern as pricing_configs
      // and production_time_configs.
      table.boolean('is_active').notNullable().defaultTo(false)
      table.integer('preferred_window_hours').notNullable()
      table.text('notes').nullable()
      table.integer('created_by_id').unsigned().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('activated_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['version'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
