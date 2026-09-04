import { FdmPricingConfigValueSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import PricingConfig from '#models/pricing_config'

export default class FdmPricingConfigValue extends FdmPricingConfigValueSchema {
  @belongsTo(() => PricingConfig)
  declare pricingConfig: BelongsTo<typeof PricingConfig>
}
