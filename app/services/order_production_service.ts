/**
 * Vendor-driven advance through production, once an order has already been
 * accepted (see order_acceptance_service.ts) - 'accepted' -> 'in_progress' ->
 * 'ready_to_ship'. Past that, the order is moved by the carrier, not the
 * vendor: the vendor buys a label (shipment_service.ts) and EasyPost tracker
 * events move it to 'shipped' and 'delivered' (shipment_tracking_service.ts).
 *
 * Eligibility here is simpler than acceptOrder's: the order is already
 * claimed, so it's just "is this vendor's own order," not a
 * technology/routing-stage capability check.
 */
import db from '@adonisjs/lucid/services/db'
import Order from '#models/order'
import OrderStatusHistory from '#models/order_status_history'
import Vendor from '#models/vendor'
import { OrderNotAvailableError, VendorNotEligibleError } from '#services/order_acceptance_service'

async function advance(
  order: Order,
  vendor: Vendor,
  userId: number,
  fromStatus: 'accepted' | 'in_progress',
  toStatus: 'in_progress' | 'ready_to_ship'
): Promise<Order> {
  if (order.vendorId !== vendor.id) {
    throw new VendorNotEligibleError(
      `Vendor ${vendor.uuid} is not eligible to update order ${order.uuid}`
    )
  }

  const previousStatus = order.status

  await db.transaction(async (trx) => {
    const updatedCount = await Order.query({ client: trx })
      .where('id', order.id)
      .where('status', fromStatus)
      .where('vendorId', vendor.id)
      .update({ status: toStatus })
      .then((result) => Number(result) || 0)

    if (updatedCount === 0) {
      throw new OrderNotAvailableError(
        `Order ${order.uuid} is not in a state that can move to ${toStatus}`
      )
    }

    await OrderStatusHistory.create(
      {
        orderId: order.id,
        oldStatus: previousStatus,
        newStatus: toStatus,
        changedById: userId,
      },
      { client: trx }
    )
  })

  await order.refresh()
  return order
}

export function startProduction(order: Order, vendor: Vendor, userId: number): Promise<Order> {
  return advance(order, vendor, userId, 'accepted', 'in_progress')
}

export function markReadyToShip(order: Order, vendor: Vendor, userId: number): Promise<Order> {
  return advance(order, vendor, userId, 'in_progress', 'ready_to_ship')
}
