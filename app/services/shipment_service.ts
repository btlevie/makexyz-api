/**
 * Vendor-bought shipping labels for instant-quote orders - the step after
 * 'ready_to_ship' (see order_production_service.ts). Labels are bought on
 * MakeXYZ's own EasyPost account and always ship from/return to MakeXYZ's
 * address (config/shipping.ts), never the vendor's. Orders from manual
 * projects aren't eligible - those vendors ship on their own accounts.
 *
 * Buying a label doesn't move the order: it stays 'ready_to_ship' until the
 * carrier's first scan arrives via the EasyPost tracker webhook (see
 * shipment_tracking_service.ts).
 *
 * Purchase flow, built so a paid label is never lost or bought twice:
 *   1. Tx: lock the order, then claim (or insert) its one 'pending' shipment
 *      by taking a short lease on it.
 *   2. Outside any transaction: if the shipment already has an EasyPost id,
 *      ask EasyPost whether it was bought (a previous attempt may have
 *      succeeded there but failed here). Otherwise create a fresh EasyPost
 *      shipment, persist its id, then buy it.
 *   3. Tx: mark the shipment 'label_created' and record the label.
 * A failure after an EasyPost id is persisted keeps the pending row (only
 * the lease is released), so the next attempt recovers the label rather
 * than buying another.
 */
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import string from '@adonisjs/core/helpers/string'
import Order from '#models/order'
import Shipment from '#models/shipment'
import ShippingLabel from '#models/shipping_label'
import type Vendor from '#models/vendor'
import { makexyzShipFromAddress } from '#config/shipping'
import { OrderNotAvailableError, VendorNotEligibleError } from '#services/order_acceptance_service'
import {
  NoMatchingRateError,
  getShippingLabelGateway,
  type LabelCustomsItem,
  type LabelParcel,
  type PurchasedLabel,
} from '#services/shipping_label_gateway_service'

/** A lease older than this belongs to a request that died - safe to take over. */
const LABEL_PURCHASE_LEASE_MINUTES = 2

/** The order isn't an instant-quote order, so it can't use MakeXYZ's shipping account. */
export class ShipmentNotEligibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShipmentNotEligibleError'
  }
}

/** The order already has a live label, or another request is buying one right now. */
export class ShipmentAlreadyExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShipmentAlreadyExistsError'
  }
}

/** International shipments need customs declarations. */
export class CustomsRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomsRequiredError'
  }
}

/** Only an unscanned label can be voided. */
export class ShipmentNotVoidableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShipmentNotVoidableError'
  }
}

export type CustomsItemInput = Omit<LabelCustomsItem, 'originCountry'> & {
  originCountry?: string | null
}

export type CreateShipmentLabelInput = {
  parcel: LabelParcel
  customsItems?: CustomsItemInput[] | null
}

export async function createShipmentLabel(
  order: Order,
  vendor: Vendor,
  input: CreateShipmentLabelInput
): Promise<Shipment> {
  if (order.vendorId !== vendor.id) {
    throw new VendorNotEligibleError(
      `Vendor ${vendor.uuid} is not eligible to ship order ${order.uuid}`
    )
  }

  await order.load('project')
  if (order.project?.source !== 'instant_quote') {
    throw new ShipmentNotEligibleError(
      `Order ${order.uuid} is not an instant-quote order and can't use MakeXYZ shipping labels`
    )
  }

  if (order.status !== 'ready_to_ship') {
    throw new OrderNotAvailableError(`Order ${order.uuid} is not ready to ship`)
  }
  if (!order.addressId || !order.shippingMethod) {
    throw new OrderNotAvailableError(`Order ${order.uuid} has no shipping address or method`)
  }
  await order.load('address')
  const toAddress = order.address

  const isInternational = toAddress.country !== 'US'
  const customsItems = input.customsItems ?? []
  if (isInternational && customsItems.length === 0) {
    throw new CustomsRequiredError(
      `Customs items are required to ship order ${order.uuid} to ${toAddress.country}`
    )
  }

  // Re-fetched so it isn't bound to the claim's already-committed transaction.
  const claimed = await claimPendingShipment(order, vendor, input.parcel)
  const shipment = await Shipment.findOrFail(claimed.id)

  const shipFrom = makexyzShipFromAddress()
  const gateway = getShippingLabelGateway()

  let label: PurchasedLabel | null = null
  try {
    if (shipment.easypostShipmentId) {
      label = await gateway.getPurchasedLabel(shipment.easypostShipmentId)
    }

    if (!label) {
      // A previous, unpurchased EasyPost shipment (if any) is simply
      // abandoned - EasyPost only charges for bought labels - so the parcel
      // from *this* request is always the one used.
      const { providerShipmentId } = await gateway.createShipment({
        toAddress: {
          name: toAddress.recipientName,
          street1: toAddress.line1,
          street2: toAddress.line2,
          city: toAddress.city,
          state: toAddress.state,
          zip: toAddress.postalCode,
          country: toAddress.country,
        },
        fromAddress: shipFrom,
        returnAddress: shipFrom,
        parcel: input.parcel,
        customs: isInternational
          ? {
              signer: shipFrom.name,
              items: customsItems.map((item) => ({
                ...item,
                originCountry: item.originCountry ?? 'US',
              })),
            }
          : null,
        reference: order.orderNumber,
      })
      shipment.easypostShipmentId = providerShipmentId
      await shipment.save()

      label = await gateway.buyShipment(providerShipmentId, order.shippingMethod)
    }
  } catch (error) {
    await releaseFailedClaim(shipment, error)
    throw error
  }

  return finalizeShipment(shipment, label)
}

/**
 * Locks the order row so two requests can't both pass the "no live
 * shipment" check, then takes the lease on its pending shipment - creating
 * one if there isn't any.
 */
async function claimPendingShipment(
  order: Order,
  vendor: Vendor,
  parcel: LabelParcel
): Promise<Shipment> {
  return db.transaction(async (trx) => {
    const lockedOrder = await Order.query({ client: trx })
      .where('id', order.id)
      .where('vendorId', vendor.id)
      .where('status', 'ready_to_ship')
      .forUpdate()
      .first()
    if (!lockedOrder) {
      throw new OrderNotAvailableError(`Order ${order.uuid} is not ready to ship`)
    }

    const now = DateTime.now()
    const active = await Shipment.query({ client: trx })
      .where('orderId', order.id)
      .whereNot('status', 'cancelled')
      .first()

    if (active && active.status !== 'pending') {
      throw new ShipmentAlreadyExistsError(
        `Order ${order.uuid} already has a shipping label - void it before buying another`
      )
    }

    if (active) {
      const leaseStartedAt = active.labelPurchaseStartedAt
      if (leaseStartedAt && leaseStartedAt > now.minus({ minutes: LABEL_PURCHASE_LEASE_MINUTES })) {
        throw new ShipmentAlreadyExistsError(
          `A shipping label for order ${order.uuid} is already being purchased`
        )
      }

      active.useTransaction(trx)
      active.merge({
        labelPurchaseStartedAt: now,
        weightOz: parcel.weightOz.toFixed(2),
        lengthIn: parcel.lengthIn.toFixed(2),
        widthIn: parcel.widthIn.toFixed(2),
        heightIn: parcel.heightIn.toFixed(2),
      })
      await active.save()
      return active
    }

    return Shipment.create(
      {
        uuid: string.uuid(),
        orderId: order.id,
        vendorId: vendor.id,
        addressId: order.addressId,
        status: 'pending',
        labelPurchaseStartedAt: now,
        weightOz: parcel.weightOz.toFixed(2),
        lengthIn: parcel.lengthIn.toFixed(2),
        widthIn: parcel.widthIn.toFixed(2),
        heightIn: parcel.heightIn.toFixed(2),
      },
      { client: trx }
    )
  })
}

/**
 * Nothing can have been bought unless an EasyPost shipment exists, and a
 * NoMatchingRateError means the buy was never attempted - in both cases the
 * pending row is dropped. Any other failure after an EasyPost id was saved
 * is ambiguous (the buy may have gone through), so the row stays for the
 * next attempt to recover, with only the lease released.
 */
async function releaseFailedClaim(shipment: Shipment, error: unknown): Promise<void> {
  if (!shipment.easypostShipmentId || error instanceof NoMatchingRateError) {
    await shipment.delete()
    return
  }
  shipment.labelPurchaseStartedAt = null
  await shipment.save()
}

async function finalizeShipment(shipment: Shipment, label: PurchasedLabel): Promise<Shipment> {
  await db.transaction(async (trx) => {
    shipment.useTransaction(trx)
    shipment.merge({
      status: 'label_created',
      carrier: label.carrier,
      serviceLevel: label.service,
      trackingNumber: label.trackingCode,
      trackingUrl: label.trackingUrl,
      easypostShipmentId: label.providerShipmentId,
      labelCreatedAt: DateTime.now(),
      labelPurchaseStartedAt: null,
    })
    await shipment.save()

    await ShippingLabel.create(
      {
        uuid: string.uuid(),
        shipmentId: shipment.id,
        provider: 'easypost',
        providerRateId: label.rateId,
        labelUrl: label.labelUrl,
        labelPdfUrl: label.labelPdfUrl,
        labelFormat: label.labelFormat,
        cost: label.cost,
      },
      { client: trx }
    )
  })

  await shipment.load('labels')
  return shipment
}

/**
 * Voids an unscanned label (asks EasyPost for a refund) and cancels the
 * shipment, so the vendor can buy a new one. Allowed whatever the order's
 * status - including after the order was refunded, which is exactly when an
 * unused label should be voided.
 */
export async function voidShipmentLabel(shipment: Shipment, vendor: Vendor): Promise<Shipment> {
  if (shipment.vendorId !== vendor.id) {
    throw new VendorNotEligibleError(
      `Vendor ${vendor.uuid} is not eligible to void shipment ${shipment.uuid}`
    )
  }
  if (shipment.status !== 'label_created' || !shipment.easypostShipmentId) {
    throw new ShipmentNotVoidableError(
      `Shipment ${shipment.uuid} can't be voided once it's ${shipment.status}`
    )
  }

  const { refundStatus } = await getShippingLabelGateway().refundLabel(shipment.easypostShipmentId)

  await db.transaction(async (trx) => {
    const now = DateTime.now()
    const labels = await ShippingLabel.query({ client: trx })
      .where('shipmentId', shipment.id)
      .whereNull('voidedAt')
    for (const label of labels) {
      label.useTransaction(trx)
      label.merge({ voidedAt: now, refundStatus })
      await label.save()
    }

    const locked = await Shipment.query({ client: trx })
      .where('id', shipment.id)
      .forUpdate()
      .firstOrFail()
    // A tracker scan may have landed between the check above and here - the
    // refund request still went out (the carrier will reject it for a
    // scanned label), but the shipment itself is live and stays that way.
    if (locked.status === 'label_created') {
      locked.merge({ status: 'cancelled', cancelledAt: now })
      await locked.save()
    }
  })

  await shipment.refresh()
  await shipment.load('labels')
  return shipment
}

/** Every shipment for an order (including cancelled ones), newest first, with labels. */
export async function listOrderShipments(order: Order): Promise<Shipment[]> {
  return Shipment.query()
    .where('orderId', order.id)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .preload('labels')
}
