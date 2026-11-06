import { VendorSchema } from '#database/schema'
import { belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Address from '#models/address'
import User from '#models/user'
import VendorImage from '#models/vendor_image'
import VendorIndicativePrice from '#models/vendor_indicative_price'
import VendorPayout from '#models/vendor_payout'
import VendorPayoutRate from '#models/vendor_payout_rate'
import VendorService from '#models/vendor_service'
import VendorTaxDocument from '#models/vendor_tax_document'
import VendorTechnologyCapability from '#models/vendor_technology_capability'

export default class Vendor extends VendorSchema {
  /** Postgres returns a real boolean, SQLite (tests) 0/1 - same as VendorTechnologyCapability. */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare acceptingInquiries: boolean

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

  @hasMany(() => VendorService)
  declare services: HasMany<typeof VendorService>

  @hasMany(() => VendorIndicativePrice)
  declare indicativePrices: HasMany<typeof VendorIndicativePrice>

  @hasMany(() => VendorImage)
  declare images: HasMany<typeof VendorImage>

  /**
   * Listed in the public directory and open to inquiries: active, accepting
   * inquiries, published, and with its public text approved. The SQL form of
   * this rule is vendor_profile_service.ts#whereListed - keep them in sync.
   */
  get isListed(): boolean {
    return (
      this.status === 'active' &&
      this.acceptingInquiries &&
      this.profilePublishedAt !== null &&
      this.profileSlug !== null &&
      this.profileModerationStatus === 'approved'
    )
  }
}
