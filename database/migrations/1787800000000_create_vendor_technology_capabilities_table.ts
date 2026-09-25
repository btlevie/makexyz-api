import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vendor_technology_capabilities'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('vendor_id').unsigned().notNullable().references('id').inTable('vendors').onDelete('CASCADE')
      table.enum('technology', ['fdm', 'sla', 'sls']).notNullable()
      // Preference is tracked per (vendor, technology), not on Vendor itself -
      // a vendor can be preferred for FDM and merely capable (not preferred)
      // for SLA.
      table.boolean('is_preferred').notNullable().defaultTo(false)
      // Declared by the vendor ('requested'), reviewed by an admin. Only
      // 'approved' capabilities count for routing - see
      // docs/VENDOR_ONBOARDING.md.
      table
        .enum('status', ['requested', 'approved', 'rejected'])
        .notNullable()
        .defaultTo('requested')
      table.timestamp('reviewed_at').nullable()
      table
        .integer('reviewed_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['vendor_id', 'technology'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
