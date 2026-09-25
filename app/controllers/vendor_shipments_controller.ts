import type { HttpContext } from '@adonisjs/core/http'
import { resolveVendor } from '#services/vendor_onboarding_service'
import Order from '#models/order'
import Shipment from '#models/shipment'
import Vendor from '#models/vendor'
import VendorShipmentTransformer from '#transformers/vendor_shipment_transformer'
import { createShipmentValidator } from '#validators/shipment'
import { OrderNotAvailableError, VendorNotEligibleError } from '#services/order_acceptance_service'
import {
  createShipmentLabel,
  listOrderShipments,
  voidShipmentLabel,
  CustomsRequiredError,
  ShipmentAlreadyExistsError,
  ShipmentNotEligibleError,
  ShipmentNotVoidableError,
} from '#services/shipment_service'
import {
  NoMatchingRateError,
  ShippingLabelGatewayError,
} from '#services/shipping_label_gateway_service'

/**
 * Instant-quote shipping labels, bought by the vendor on MakeXYZ's EasyPost
 * account - see shipment_service.ts.
 */
export default class VendorShipmentsController {
  /** This vendor's own order, or an HTTP error response already sent. */
  private async resolveOrder(ctx: HttpContext, vendor: Vendor): Promise<Order | null> {
    const order = await Order.findBy('uuid', ctx.params.uuid)
    if (!order) {
      ctx.response.notFound({ error: 'Order not found' })
      return null
    }
    if (order.vendorId !== vendor.id) {
      ctx.response.forbidden({ error: `Order ${order.uuid} does not belong to this vendor` })
      return null
    }
    return order
  }

  /** Every shipment for the order, voided ones included, newest first. */
  async index(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }
    const order = await this.resolveOrder(ctx, vendor)
    if (!order) return

    const shipments = await listOrderShipments(order)
    return await serialize(VendorShipmentTransformer.transform(shipments))
  }

  /** Buys the order's shipping label - the service is picked from what the customer paid for. */
  async store(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }
    const order = await this.resolveOrder(ctx, vendor)
    if (!order) return

    const input = await request.validateUsing(createShipmentValidator)

    try {
      const shipment = await createShipmentLabel(order, vendor, input)
      return await serialize(VendorShipmentTransformer.transform(shipment))
    } catch (error) {
      if (error instanceof VendorNotEligibleError || error instanceof ShipmentNotEligibleError) {
        return response.forbidden({ error: error.message })
      }
      if (error instanceof OrderNotAvailableError || error instanceof ShipmentAlreadyExistsError) {
        return response.conflict({ error: error.message })
      }
      if (error instanceof CustomsRequiredError || error instanceof NoMatchingRateError) {
        return response.unprocessableEntity({ error: error.message })
      }
      if (error instanceof ShippingLabelGatewayError) {
        return response.badGateway({ error: error.message })
      }
      throw error
    }
  }

  /** Voids an unscanned label so a new one can be bought. */
  async void(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }
    const order = await this.resolveOrder(ctx, vendor)
    if (!order) return

    const shipment = await Shipment.query()
      .where('uuid', params.shipmentUuid)
      .where('orderId', order.id)
      .first()
    if (!shipment) {
      return response.notFound({ error: 'Shipment not found' })
    }

    try {
      const voided = await voidShipmentLabel(shipment, vendor)
      return await serialize(VendorShipmentTransformer.transform(voided))
    } catch (error) {
      if (error instanceof VendorNotEligibleError) {
        return response.forbidden({ error: error.message })
      }
      if (error instanceof ShipmentNotVoidableError) {
        return response.conflict({ error: error.message })
      }
      if (error instanceof ShippingLabelGatewayError) {
        return response.badGateway({ error: error.message })
      }
      throw error
    }
  }
}
