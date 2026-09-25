import type { HttpContext } from '@adonisjs/core/http'
import { hasCurrentAgreement, resolveVendor } from '#services/vendor_onboarding_service'
import Order from '#models/order'
import OrderTransformer from '#transformers/order_transformer'
import {
  acceptOrder,
  listAcceptableOrders,
  OrderNotAvailableError,
  VendorNotEligibleError,
} from '#services/order_acceptance_service'
import { startProduction, markReadyToShip } from '#services/order_production_service'
import {
  computePayoutBreakdown,
  PayoutRateMissingError,
} from '#services/payout_calculation_service'
import {
  isPayoutMethodReady,
  PayoutMethodNotReadyError,
} from '#services/vendor_payout_method_service'

export default class VendorOrdersController {
  /**
   * Whatever the calling vendor is currently eligible to accept - preferred-
   * stage orders only if they're preferred for every required technology,
   * plus every open-stage order they're capable of.
   */
  async index(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const orders = await listAcceptableOrders(vendor)

    // What the vendor would earn for each order - or why they can't accept it
    // yet (no payout method, or no rate for one of its materials).
    const methodReady = isPayoutMethodReady(vendor)
    const agreementCurrent = hasCurrentAgreement(vendor)
    for (const order of orders) {
      try {
        const breakdown = await computePayoutBreakdown(order, vendor)
        order.$extras.estimatedPayout = breakdown.total
        if (!methodReady) {
          order.$extras.payoutBlockedReason = 'Set up how you get paid before accepting orders'
        } else if (!agreementCurrent) {
          // Not payout-related, but it's the one "why can't I accept this"
          // field the listing has - acceptOrder refuses a stale agreement.
          order.$extras.payoutBlockedReason =
            'Accept the updated vendor agreement before accepting orders'
        }
      } catch (error) {
        if (!(error instanceof PayoutRateMissingError)) throw error
        order.$extras.estimatedPayout = null
        order.$extras.payoutBlockedReason = error.message
      }
    }

    return await serialize(OrderTransformer.transform(orders))
  }

  /**
   * This vendor's own orders already accepted and still in the production
   * pipeline - index above only ever shows the open queue available to
   * accept, so without this there's no way to find an order again after
   * accepting it.
   */
  async active(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const orders = await Order.query()
      .where('vendorId', vendor.id)
      .whereIn('status', ['accepted', 'in_progress', 'ready_to_ship'])
      .orderBy('createdAt', 'asc')
      .preload('items')
      .preload('address')
      .preload('shipments')
    return await serialize(OrderTransformer.transform(orders))
  }

  /**
   * Accepts an order, which triggers payment capture - see
   * order_acceptance_service#acceptOrder.
   */
  async accept(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
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
      if (error instanceof PayoutMethodNotReadyError || error instanceof PayoutRateMissingError) {
        return response.unprocessableEntity({ error: error.message })
      }
      if (error instanceof OrderNotAvailableError) {
        return response.conflict({ error: error.message })
      }
      throw error
    }
  }

  /** Marks an already-accepted order as being worked on - see order_production_service.ts. */
  async startProduction(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const order = await Order.findBy('uuid', params.uuid)
    if (!order) {
      return response.notFound({ error: 'Order not found' })
    }

    try {
      const updated = await startProduction(order, vendor, ctx.auth.getUserOrFail().id)
      await updated.load('items')
      return await serialize(OrderTransformer.transform(updated))
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

  /** Marks a produced order ready for pickup/shipment - see order_production_service.ts. */
  async readyToShip(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const order = await Order.findBy('uuid', params.uuid)
    if (!order) {
      return response.notFound({ error: 'Order not found' })
    }

    try {
      const updated = await markReadyToShip(order, vendor, ctx.auth.getUserOrFail().id)
      await updated.load('items')
      return await serialize(OrderTransformer.transform(updated))
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
