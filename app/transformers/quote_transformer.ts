import { BaseTransformer } from '@adonisjs/core/transformers'
import type Quote from '#models/quote'
import AddressTransformer from '#transformers/address_transformer'

export default class QuoteTransformer extends BaseTransformer<Quote> {
  async toObject() {
    return {
      uuid: this.resource.uuid,
      status: this.resource.status,
      // Only meaningful when status is 'needs_review' - lets the frontend
      // tailor its "further review needed" message per reason without a
      // backend change next time a second trigger reason exists.
      reviewReason: this.resource.reviewReason,
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
      shippingAddress: this.resource.address
        ? await AddressTransformer.transform(this.resource.address)
        : null,
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
