import { BaseTransformer } from '@adonisjs/core/transformers'
import type { ProductionTimeOption } from '#services/production_time_service'

export default class ProductionTimeOptionTransformer extends BaseTransformer<ProductionTimeOption> {
  async toObject() {
    return {
      businessDays: this.resource.businessDays,
      // Decimal string, same format as a quote's productionTimeFeeAmount.
      feeAmount: this.resource.feeAmount.toFixed(2),
      isStandard: this.resource.isStandard,
      available: this.resource.available,
    }
  }
}
