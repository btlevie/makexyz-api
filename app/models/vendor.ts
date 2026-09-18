import { VendorSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import VendorTechnologyCapability from '#models/vendor_technology_capability'

export default class Vendor extends VendorSchema {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @hasMany(() => VendorTechnologyCapability)
  declare technologyCapabilities: HasMany<typeof VendorTechnologyCapability>
}
