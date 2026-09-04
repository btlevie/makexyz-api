import { QuoteItemSchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import PricingConfig from '#models/pricing_config'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'

export default class QuoteItem extends QuoteItemSchema {
  /**
   * Redeclared on purpose - the generated schema types this column but does not
   * serialize it. Postgres jsonb hands back a parsed object while SQLite (tests)
   * hands back a string, so normalize both directions here rather than leaving
   * callers to guess which they got.
   */
  @column({
    prepare: (value: unknown) => (value === null || value === undefined ? value : JSON.stringify(value)),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
  })
  declare pricingSnapshot: any | null

  @belongsTo(() => Quote)
  declare quote: BelongsTo<typeof Quote>

  @belongsTo(() => ProjectFile)
  declare projectFile: BelongsTo<typeof ProjectFile>

  @belongsTo(() => PricingConfig)
  declare pricingConfig: BelongsTo<typeof PricingConfig>
}
