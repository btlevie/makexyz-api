import type { HttpContext } from '@adonisjs/core/http'
import Order from '#models/order'
import Vendor from '#models/vendor'
import OrderTransformer from '#transformers/order_transformer'
import {
  acceptOrder,
  listAcceptableOrders,
  OrderNotAvailableError,
  VendorNotEligibleError,
} from '#services/order_acceptance_service'

export default class VendorOrdersController {
  /**
   * Resolves the calling user's Vendor record, or null if they aren't a
   * vendor at all. No established policy/ability convention exists yet in
   * this codebase (see CLAUDE.md) - a manual role check, same as `isStaff` in
   * project_grant_service.ts.
   */
  private async resolveVendor(ctx: HttpContext): Promise<Vendor | null> {
    const user = ctx.auth.getUserOrFail()
    if (user.role !== 'vendor') {
      return null
    }
    return Vendor.findBy('userId', user.id)
  }

  /**
   * Whatever the calling vendor is currently eligible to accept - preferred-
   * stage orders only if they're preferred for every required technology,
   * plus every open-stage order they're capable of.
   */
  async index(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await this.resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const orders = await listAcceptableOrders(vendor)
    return await serialize(OrderTransformer.transform(orders))
  }

  /**
   * Accepts an order, which triggers payment capture - see
   * order_acceptance_service#acceptOrder.
   */
  async accept(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const vendor = await this.resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const order = await Order.findBy('uuid', params.uuid)
    if (!order) {
      return response.notFound({ error: 'Order not found' })
    }

    try {
      const accepted = await acceptOrder(order, vendor, ctx.auth.getUserOrFail().id)
      await accepted.load('items')
      return await serialize(OrderTransformer.transform(accepted))
    } catch (error) {
      if (error instanceof VendorNotEligibleError) {
        return response.forbidden({ error: error.message })
      }
      if (error instanceof OrderNotAvailableError) {
        return response.conflict({ error: error.message })
      }
      throw error
    }
  }
}
