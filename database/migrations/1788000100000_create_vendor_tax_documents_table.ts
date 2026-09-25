import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vendor_tax_documents'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table
        .integer('vendor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('vendors')
        .onDelete('CASCADE')
      table.enum('form_type', ['w9', 'w8ben', 'w8bene']).notNullable()
      // Private s3 disk key - never exposed; admins download via a short-lived
      // signed URL.
      table.string('storage_key').notNullable()
      table.string('original_name').nullable()
      table.timestamp('verified_at').nullable()
      table
        .integer('verified_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('rejected_at').nullable()
      table.string('rejected_reason').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
