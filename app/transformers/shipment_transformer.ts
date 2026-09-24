import { BaseTransformer } from '@adonisjs/core/transformers'
import type Shipment from '#models/shipment'

/** Tracking fields shared by the customer and vendor views of a shipment. */
export function shipmentTrackingFields(shipment: Shipment) {
  return {
    uuid: shipment.uuid,
    status: shipment.status,
    carrier: shipment.carrier,
    serviceLevel: shipment.serviceLevel,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    trackerStatus: shipment.trackerStatus,
    labelCreatedAt: shipment.labelCreatedAt,
    shippedAt: shipment.shippedAt,
    deliveredAt: shipment.deliveredAt,
    cancelledAt: shipment.cancelledAt,
  }
}

/**
 * Customer-safe shipment view: tracking only. Label URLs and label cost are
 * MakeXYZ/vendor-facing - see VendorShipmentTransformer.
 */
export default class ShipmentTransformer extends BaseTransformer<Shipment> {
  toObject() {
    return shipmentTrackingFields(this.resource)
  }
}
