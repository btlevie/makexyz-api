import { BaseTransformer } from '@adonisjs/core/transformers'
import { SHIPPING_METHOD_NAMES, type ShippingOption } from '#services/shipping_service'

export default class ShippingOptionTransformer extends BaseTransformer<ShippingOption> {
  async toObject() {
    return {
      method: this.resource.method,
      name: SHIPPING_METHOD_NAMES[this.resource.method],
      // Decimal string, same format as a quote's shippingFeeAmount.
      feeAmount: this.resource.feeAmount.toFixed(2),
    }
  }
}
