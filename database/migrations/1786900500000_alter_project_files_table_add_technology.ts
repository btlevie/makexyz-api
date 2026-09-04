import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_files'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Determines which slicing pipeline the Lambda runs (see prusa-slicer repo's
      // app/app.py) and which shape of slice-variant data to expect back.
      // notNullable + defaultTo('fdm') so every existing row backfills cleanly.
      table.enum('technology', ['fdm', 'sla']).notNullable().defaultTo('fdm')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('technology')
    })
  }
}
