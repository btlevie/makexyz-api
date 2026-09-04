import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_files'

  async up() {
    // knex's `.enum(...).alter()` doesn't reliably widen an existing
    // check-constraint-backed enum across dialects (it generates invalid SQL on
    // Postgres, and SQLite has no ALTER COLUMN/DROP CONSTRAINT at all) - drop and
    // recreate the column instead, which knex handles correctly on both. Nothing
    // is in production yet, so resetting existing rows to the 'fdm' default is
    // an acceptable, one-time cost for a much simpler, cross-dialect migration.
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('technology')
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.enum('technology', ['fdm', 'sla', 'sls']).notNullable().defaultTo('fdm')
      // double, not decimal - matches volume/x/y/z (also computed float
      // measurements from the slicer, not a money-like value needing exact
      // decimal precision), so this comes through as `number`, not `string`.
      table.double('surface_area_mm_2')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('technology')
      table.dropColumn('surface_area_mm_2')
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.enum('technology', ['fdm', 'sla']).notNullable().defaultTo('fdm')
    })
  }
}
