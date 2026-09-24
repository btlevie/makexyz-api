import type { HttpContext } from '@adonisjs/core/http'
import Vendor from '#models/vendor'
import VendorPayout from '#models/vendor_payout'
import VendorPayoutTransformer from '#transformers/vendor_payout_transformer'

export default class VendorPayoutsController {
  /** Same manual role check as vendor_orders_controller.ts. */
  private async resolveVendor(ctx: HttpContext): Promise<Vendor | null> {
    const user = ctx.auth.getUserOrFail()
    if (user.role !== 'vendor') {
      return null
    }
    return Vendor.findBy('userId', user.id)
  }

  /** The vendor's own payouts, newest first - earned, scheduled, and paid. */
  async index(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await this.resolveVendor(ctx)
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
