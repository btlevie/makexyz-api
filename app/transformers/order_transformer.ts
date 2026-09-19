import { BaseTransformer } from '@adonisjs/core/transformers'
import type Order from '#models/order'
import AddressTransformer from '#transformers/address_transformer'

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
      shippingAddress: this.resource.address
        ? await AddressTransformer.transform(this.resource.address)
        : null,
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
