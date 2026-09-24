import { BaseTransformer } from '@adonisjs/core/transformers'
import type Shipment from '#models/shipment'
import { shipmentTrackingFields } from '#transformers/shipment_transformer'

/** The vendor's view of a shipment: tracking plus the label they print. */
export default class VendorShipmentTransformer extends BaseTransformer<Shipment> {
  toObject() {
    const labels = this.resource.labels ?? []
    // At most one label per shipment today; a voided shipment's label is
    // still returned (with voidedAt/refundStatus) so the vendor can see it.
    const label = labels[labels.length - 1] ?? null

    return {
      ...shipmentTrackingFields(this.resource),
      parcel: {
        weightOz: this.resource.weightOz,
        lengthIn: this.resource.lengthIn,
        widthIn: this.resource.widthIn,
        heightIn: this.resource.heightIn,
      },
      label: label
        ? {
            uuid: label.uuid,
            labelUrl: label.labelUrl,
            labelPdfUrl: label.labelPdfUrl,
            labelFormat: label.labelFormat,
            cost: label.cost,
            voidedAt: label.voidedAt,
            refundStatus: label.refundStatus,
          }
        : null,
    }
  }
}
