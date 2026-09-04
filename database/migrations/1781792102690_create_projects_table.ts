import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'projects'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table.integer('customer_id').unsigned().references('id').inTable('customers').onDelete('SET NULL')
      table.string('title')
      table.text('description').nullable()
      table.enum('status', ['draft' , 'quoted', 'awaiting_checkout', 'ordered', 'fulfilled', 'cancelled', 'expired']).notNullable().defaultTo('draft')
      // Which flow this request arrived through. Fixed at creation and shared by
      // every quote revision, so it lives here rather than on quotes. Drives
      // funnel segmentation and tells the cleanup jobs which projects are
      // theirs to expire.
      table.enum('source', ['instant_quote', 'manual']).notNullable().defaultTo('instant_quote')
      table.jsonb('metadata').nullable()
      table.timestamp('expired_at').nullable()
      table.timestamp('cancelled_at').nullable()
      table.timestamp('fulfilled_at').nullable()
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}