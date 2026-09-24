import { BaseTransformer } from '@adonisjs/core/transformers'
import type VendorPayout from '#models/vendor_payout'

/**
 * A payout as its vendor (and admins) see it. `orderUuid` / `vendorUuid` are
 * only present when the relation was preloaded.
 */
export default class VendorPayoutTransformer extends BaseTransformer<VendorPayout> {
  toObject() {
    return {
      uuid: this.resource.uuid,
      orderUuid: this.resource.order?.uuid,
      vendorUuid: this.resource.vendor?.uuid,
      status: this.resource.status,
      provider: this.resource.provider,
      amount: this.resource.amount,
      breakdown: this.resource.breakdown,
      eligibleAt: this.resource.eligibleAt,
      holdReason: this.resource.holdReason,
      failureReason: this.resource.failureReason,
      failureKind: this.resource.failureKind,
      providerTransactionId: this.resource.providerTransactionId,
      paidAt: this.resource.paidAt,
      failedAt: this.resource.failedAt,
      cancelledAt: this.resource.cancelledAt,
      createdAt: this.resource.createdAt,
    }
  }
}
