import { BaseTransformer } from '@adonisjs/core/transformers'
import type Quote from '#models/quote'

export default class QuoteTransformer extends BaseTransformer<Quote> {
  async toObject() {
    return {
      uuid: this.resource.uuid,
      status: this.resource.status,
      revision: this.resource.revision,
      generatedBy: this.resource.generatedBy,
      subtotal: this.resource.subtotal,
      tax: this.resource.tax,
      total: this.resource.total,
      destinationCountry: this.resource.destinationCountry,
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
        // Full calculation breakdown, for support and auditing.
        pricing: item.pricingSnapshot,
      })),
    }
  }
}
