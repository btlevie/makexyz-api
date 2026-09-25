import { VendorTaxDocumentSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Vendor from '#models/vendor'

export type VendorTaxDocumentStatus = 'uploaded' | 'verified' | 'rejected'

export default class VendorTaxDocument extends VendorTaxDocumentSchema {
  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>

  @belongsTo(() => User, { foreignKey: 'verifiedById' })
  declare verifiedBy: BelongsTo<typeof User>

  get status(): VendorTaxDocumentStatus {
    if (this.verifiedAt) return 'verified'
    if (this.rejectedAt) return 'rejected'
    return 'uploaded'
  }
}
