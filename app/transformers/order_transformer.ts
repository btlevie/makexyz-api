import { BaseTransformer } from '@adonisjs/core/transformers'
import type Order from '#models/order'

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
