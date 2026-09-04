import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'materials'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('uuid').notNullable().unique()
      table.string('name').notNullable()
      table.text('description').nullable()
      table.enum('technology', ['fdm', 'sla', 'sls']).notNullable()
      // The explicit marker for "this is the material a technology resolves to
      // when none is specified" - assertDefaultMaterialsConfigured
      // (start/material_defaults.ts) verifies one exists per technology before
      // the server starts.
      table.boolean('is_default').notNullable().defaultTo(false)
      // Internal cost of filament in USD per gram (e.g. a $20/kg spool -> 0.02).
      // This is the true cost basis for the bulk pricing floor, NOT the
      // customer-facing model material rate, which lives in the pricing config.
      table.decimal('true_cost_per_gram', 12, 6).nullable()
      // Nullable like trueCostPerGram - materials without a known density (e.g.
      // today's SLA/SLS placeholders) simply skip the grams-rescaling step in
      // ProjectFilesController#updateMaterial rather than blocking anything.
      table.decimal('density_g_per_cm_3', 10, 4).nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
