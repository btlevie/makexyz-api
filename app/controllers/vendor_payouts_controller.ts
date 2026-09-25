import type { HttpContext } from '@adonisjs/core/http'
import { resolveVendor } from '#services/vendor_onboarding_service'
import VendorPayout from '#models/vendor_payout'
import VendorPayoutTransformer from '#transformers/vendor_payout_transformer'

export default class VendorPayoutsController {
  /** The vendor's own payouts, newest first - earned, scheduled, and paid. */
  async index(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const payouts = await VendorPayout.query()
      .where('vendorId', vendor.id)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .preload('order')
    return await serialize(VendorPayoutTransformer.transform(payouts))
  }
}
