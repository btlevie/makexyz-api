/**
 * Applies EasyPost tracker updates (see easypost_webhooks_controller.ts) to a
 * shipment and its order. This is the only thing that moves an instant-quote
 * order past 'ready_to_ship':
 *
 *   carrier's first scan -> order 'ready_to_ship' -> 'shipped'  (sets shipped_at)
 *   delivered            -> order 'shipped' -> 'delivered'     (sets delivered_at)
 *
 * orders.delivered_at (plus the 'shipped' -> 'delivered' status history row)
 * is what the vendor payout timeline starts from. A 'delivered' event that
 * skips the in-transit scans still moves the order through 'shipped' first,
 * so both history rows always exist.
 *
 * Must never throw on a business-state mismatch - EasyPost retries any
 * non-2xx delivery. An order that has since moved elsewhere (refunded,
 * cancelled) is left alone; the shipment row still records what the carrier
 * reported. Shipment status only ever moves forward, since EasyPost doesn't
 * guarantee event order.
 */
import { type DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Order from '#models/order'
import OrderStatusHistory from '#models/order_status_history'
import Shipment from '#models/shipment'

type ShipmentStatus = Shipment['status']

const IN_TRANSIT_TRACKER_STATUSES = ['in_transit', 'out_for_delivery', 'available_for_pickup']

/** Forward-only ordering for live shipments. 'cancelled' is handled separately. */
const SHIPMENT_STATUS_RANK: Record<Exclude<ShipmentStatus, 'cancelled'>, number> = {
  pending: 0,
  label_created: 1,
  shipped: 2,
  in_transit: 2,
  delivered: 3,
}

function targetShipmentStatus(trackerStatus: string): 'in_transit' | 'delivered' | null {
  if (trackerStatus === 'delivered') return 'delivered'
  if (IN_TRANSIT_TRACKER_STATUSES.includes(trackerStatus)) return 'in_transit'
  return null
}

export async function applyTrackerUpdate(
  shipmentId: number,
  trackerStatus: string,
  occurredAt: DateTime,
  trx: TransactionClientContract
): Promise<void> {
  const shipment = await Shipment.query({ client: trx })
    .where('id', shipmentId)
    .forUpdate()
    .firstOrFail()
  shipment.useTransaction(trx)

  // A pending (not yet bought) or voided shipment only records what the
  // carrier says - a voided label that gets scanned anyway is worth seeing,
  // but it must not drive the order.
  if (shipment.status === 'pending' || shipment.status === 'cancelled') {
    shipment.trackerStatus = trackerStatus
    await shipment.save()
    return
  }

  const target = targetShipmentStatus(trackerStatus)
  const currentRank = SHIPMENT_STATUS_RANK[shipment.status]

  // Late, out-of-order events (e.g. an in_transit scan arriving after
  // delivered) are dropped entirely, raw tracker status included.
  if (shipment.status === 'delivered' && trackerStatus !== 'delivered') {
    return
  }
  shipment.trackerStatus = trackerStatus

  if (target && SHIPMENT_STATUS_RANK[target] > currentRank) {
    shipment.status = target
    shipment.shippedAt ??= occurredAt
    if (target === 'in_transit') {
      shipment.inTransitAt ??= occurredAt
    } else {
      shipment.deliveredAt = occurredAt
    }
  }
  await shipment.save()

  if (!shipment.orderId || !target) {
    return
  }

  await transitionOrder(shipment.orderId, 'ready_to_ship', 'shipped', occurredAt, trx)

  if (shipment.status === 'delivered') {
    const undelivered = await Shipment.query({ client: trx })
      .where('orderId', shipment.orderId)
      .whereNotIn('status', ['delivered', 'cancelled'])
      .first()
    if (!undelivered) {
      await transitionOrder(shipment.orderId, 'shipped', 'delivered', occurredAt, trx)
    }
  }
}

/**
 * Race-safe conditional transition, same pattern as order_production_service's
 * advance() - but a no-op (not an error) when the order isn't in `from`,
 * since webhook redelivery and out-of-band status changes are expected here.
 * No user made this change, so the history row's changedById is null.
 */
async function transitionOrder(
  orderId: number,
  from: 'ready_to_ship' | 'shipped',
  to: 'shipped' | 'delivered',
  at: DateTime,
  trx: TransactionClientContract
): Promise<boolean> {
  const updatedCount = await Order.query({ client: trx })
    .where('id', orderId)
    .where('status', from)
    .update({ status: to })
    .then((result) => Number(result) || 0)

  if (updatedCount === 0) {
    return false
  }

  const order = await Order.findOrFail(orderId, { client: trx })
  order.useTransaction(trx)
  if (to === 'shipped') {
    order.shippedAt = at
  } else {
    order.deliveredAt = at
  }
  await order.save()

  await OrderStatusHistory.create(
    { orderId, oldStatus: from, newStatus: to, changedById: null },
    { client: trx }
  )
  return true
}
