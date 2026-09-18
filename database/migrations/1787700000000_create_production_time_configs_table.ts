import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'production_time_configs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('name').notNullable()
      table.integer('version').notNullable()
      // Exactly one active row at a time - same pattern as pricing_configs,
      // but with no technology dimension: production time is priced the same
      // way regardless of FDM/SLA/SLS.
      table.boolean('is_active').notNullable().defaultTo(false)
      // The "days saved" reference point the exponential fee formula measures
      // from (fee(daysSaved) = baseFee * (growthRate ^ daysSaved - 1), where
      // daysSaved = standardBusinessDays - selectedBusinessDays). Selectable
      // day counts themselves live in production_time_tiers, not here.
      table.integer('standard_business_days').notNullable()
      table.decimal('base_fee', 12, 6).notNullable()
      table.decimal('growth_rate', 12, 6).notNullable()
      table.text('notes').nullable()
      table.integer('created_by_id').unsigned().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('activated_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['version'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
