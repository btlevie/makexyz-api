import { BaseTransformer } from '@adonisjs/core/transformers'
import type Order from '#models/order'
import AddressTransformer from '#transformers/address_transformer'
import ShipmentTransformer from '#transformers/shipment_transformer'

export default class OrderTransformer extends BaseTransformer<Order> {
  async toObject() {
    return {
      uuid: this.resource.uuid,
      orderNumber: this.resource.orderNumber,
      status: this.resource.status,
      subtotal: this.resource.subtotal,
      tax: this.resource.tax,
      total: this.resource.total,
      shippingMethod: this.resource.shippingMethod,
      shippingFeeAmount: this.resource.shippingFeeAmount,
      productionTimeBusinessDays: this.resource.productionTimeBusinessDays,
      productionTimeFeeAmount: this.resource.productionTimeFeeAmount,
      shippedAt: this.resource.shippedAt,
      deliveredAt: this.resource.deliveredAt,
      shippingAddress: this.resource.address
        ? await AddressTransformer.transform(this.resource.address)
        : null,
      // Tracking only - label URLs/cost never reach the customer. Only
      // present when the caller preloaded shipments; pending (not yet bought)
      // and cancelled (voided) shipments are left out.
      shipments: this.resource.shipments
        ? await ShipmentTransformer.transform(
            this.resource.shipments.filter(
              (shipment) => shipment.status !== 'pending' && shipment.status !== 'cancelled'
            )
          )
        : undefined,
      items: this.resource.items.map((item) => ({
        itemType: item.itemType,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
      })),
    }
  }
}
