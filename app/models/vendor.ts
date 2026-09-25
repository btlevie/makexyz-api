import { VendorSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Address from '#models/address'
import User from '#models/user'
import VendorPayout from '#models/vendor_payout'
import VendorPayoutRate from '#models/vendor_payout_rate'
import VendorTaxDocument from '#models/vendor_tax_document'
import VendorTechnologyCapability from '#models/vendor_technology_capability'

export default class Vendor extends VendorSchema {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'activatedById' })
  declare activatedBy: BelongsTo<typeof User>

  @hasMany(() => VendorTaxDocument)
  declare taxDocuments: HasMany<typeof VendorTaxDocument>

  @hasMany(() => VendorTechnologyCapability)
  declare technologyCapabilities: HasMany<typeof VendorTechnologyCapability>

  @hasMany(() => Address)
  declare addresses: HasMany<typeof Address>

  @hasMany(() => VendorPayoutRate)
  declare payoutRates: HasMany<typeof VendorPayoutRate>

  @hasMany(() => VendorPayout)
  declare payouts: HasMany<typeof VendorPayout>
}
