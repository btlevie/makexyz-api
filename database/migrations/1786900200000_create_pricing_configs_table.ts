import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'pricing_configs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      // Manufacturing technology this configuration prices. The constants
      // themselves live in a per-technology values table (e.g.
      // fdm_pricing_config_values) rather than here, so a future technology
      // adds a table instead of widening this one with nullable columns.
      table.enum('technology', ['fdm']).notNullable()
      table.string('name').notNullable()
      table.integer('version').notNullable()
      // Exactly one active row per technology. Not enforced by a partial unique
      // index (awkward across pg/sqlite) - PricingConfigService.activateConfig
      // owns the transition and getActive* refuses to resolve an ambiguous state.
      table.boolean('is_active').notNullable().defaultTo(false)
      table.text('notes').nullable()
      table.integer('created_by_id').unsigned().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('activated_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['technology', 'version'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
