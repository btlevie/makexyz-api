import { ProductionTimeTierSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ProductionTimeConfig from '#models/production_time_config'

export default class ProductionTimeTier extends ProductionTimeTierSchema {
  @belongsTo(() => ProductionTimeConfig)
  declare productionTimeConfig: BelongsTo<typeof ProductionTimeConfig>
}
