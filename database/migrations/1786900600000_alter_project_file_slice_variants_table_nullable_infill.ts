import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'project_file_slice_variants'

  async up() {
    // SLA variant rows never have an infill value (no infill analog for SLA - see
    // sla_slicing.py in the prusa-slicer repo). layer_height stays notNullable -
    // both SLA variants always report a real one, same as FDM.
    //
    // Plain scalar widening (integer -> nullable integer), not the enum/CHECK
    // alteration that was unreliable on SQLite for the `variant` column earlier -
    // lower risk, but still confirmed empirically (see Verification) rather than
    // assumed.
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('infill').nullable().alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('infill').notNullable().alter()
    })
  }
}
