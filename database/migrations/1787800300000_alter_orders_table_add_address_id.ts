import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Copied forward from quotes.address_id at checkout authorize - see
      // app/services/checkout_service.ts#authorizeCheckoutSession. No
      // onDelete('SET NULL') - deleting an address an order still points to
      // is refused at the app layer (address_service#deleteAddress).
      table.integer('address_id').unsigned().references('id').inTable('addresses').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('address_id')
    })
  }
}
