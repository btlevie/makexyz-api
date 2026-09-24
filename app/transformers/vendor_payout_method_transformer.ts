import { BaseTransformer } from '@adonisjs/core/transformers'
import type Vendor from '#models/vendor'
import { payoutMethodStatus } from '#services/vendor_payout_method_service'

/**
 * How a vendor gets paid. Account ids are never exposed - only whether each
 * rail is connected and ready.
 */
export default class VendorPayoutMethodTransformer extends BaseTransformer<Vendor> {
  toObject() {
    return {
      provider: this.resource.payoutProvider,
      status: payoutMethodStatus(this.resource),
      error: this.resource.payoutMethodError,
      stripeConnected: !!this.resource.stripeAccountId,
      stripeOnboardingComplete: !!this.resource.stripePayoutsEnabled,
      paypalConnected: !!this.resource.paypalPayerId,
      paypalEmail: this.resource.paypalEmail,
      payoutHoldDays: this.resource.payoutHoldDays,
    }
  }
}
