import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vendor_services'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('vendor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('vendors')
        .onDelete('CASCADE')
      // Services beyond printing, quoted through manual quotes. Printing isn't
      // a row here - it comes from approved vendor_technology_capabilities.
      table.enum('service', ['design', 'scanning', 'cnc']).notNullable()
      table.boolean('active').notNullable().defaultTo(true)
      // Set when an admin turns the service off; the vendor can't turn it
      // back on themselves while this is set.
      table.timestamp('admin_disabled_at').nullable()
      // e.g. the hourly design rate. Indicative, never binding.
      table.decimal('rate', 10, 2).nullable()
      table.enum('rate_unit', ['hour', 'project']).nullable()
      // Public text - moderated with the rest of the profile.
      table.text('description').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['vendor_id', 'service'])
      table.index(['service', 'active'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
