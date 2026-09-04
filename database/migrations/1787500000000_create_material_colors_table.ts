import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'material_colors'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('uuid').notNullable().unique()
      table
        .integer('material_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('materials')
        .onDelete('CASCADE')
      table.string('name').notNullable()
      table.string('hex').nullable()
      // Exactly one default per material. Not enforced by a partial unique index
      // (awkward across pg/sqlite, same reasoning as pricing_configs.is_active) -
      // resolveDefaultColor refuses to resolve an ambiguous or missing state.
      table.boolean('is_default').notNullable().defaultTo(false)

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['material_id', 'name'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
