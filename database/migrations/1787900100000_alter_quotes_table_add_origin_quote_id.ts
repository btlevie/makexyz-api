import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'quotes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // A project only ever had one quote revision chain before quote
      // splitting existed. Null means "I am a lineage root" (an
      // auto-generated quote, or a newly split-off one); every later
      // revision within that lineage (via configureQuote) copies the root
      // forward. See quote_generation_service.ts/quotes_controller.ts for
      // the "latest revision" queries this backs.
      table
        .integer('origin_quote_id')
        .unsigned()
        .references('id')
        .inTable('quotes')
        .onDelete('SET NULL')
        .nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('origin_quote_id')
    })
  }
}
