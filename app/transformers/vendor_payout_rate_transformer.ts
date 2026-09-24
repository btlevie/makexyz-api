import { BaseTransformer } from '@adonisjs/core/transformers'
import type VendorPayoutRate from '#models/vendor_payout_rate'

/** Expects `material` preloaded. */
export default class VendorPayoutRateTransformer extends BaseTransformer<VendorPayoutRate> {
  toObject() {
    return {
      materialUuid: this.resource.material.uuid,
      materialName: this.resource.material.name,
      technology: this.resource.material.technology,
      percentage: this.resource.percentage,
    }
  }
}
