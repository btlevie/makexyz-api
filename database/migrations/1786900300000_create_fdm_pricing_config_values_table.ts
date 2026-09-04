import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'fdm_pricing_config_values'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('pricing_config_id')
        .unsigned()
        .notNullable()
        .unique()
        .references('id')
        .inTable('pricing_configs')
        .onDelete('CASCADE')

      // Every constant is notNullable on purpose: a half-populated configuration
      // must fail loudly at load time rather than silently price part of a quote
      // at zero. Multipliers are stored as multipliers, not percentages -
      // failure_buffer_multiplier 1.10 means "110% of base", not "1.10%".
      table.decimal('model_material_rate_per_gram', 12, 6).notNullable()
      table.decimal('support_material_rate_per_gram', 12, 6).notNullable()
      table.decimal('machine_rate_per_hour', 12, 6).notNullable()
      table.decimal('failure_buffer_multiplier', 12, 6).notNullable()
      table.decimal('fixed_line_item_charge', 12, 6).notNullable()
      table.decimal('bulk_floor_small_multiplier', 12, 6).notNullable()
      table.decimal('bulk_floor_large_multiplier', 12, 6).notNullable()
      table.decimal('bulk_floor_break_grams', 12, 6).notNullable()
      table.decimal('bulk_floor_sigmoid_width_grams', 12, 6).notNullable()
      table.decimal('quantity_decay_constant', 12, 6).notNullable()
      table.decimal('oversize_threshold_mm', 12, 6).notNullable()
      table.decimal('oversize_multiplier', 12, 6).notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
