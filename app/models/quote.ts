import { QuoteSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Address from '#models/address'
import Project from '#models/project'
import QuoteFee from '#models/quote_fee'
import QuoteItem from '#models/quote_item'

export default class Quote extends QuoteSchema {
  @belongsTo(() => Project)
  declare project: BelongsTo<typeof Project>

  @hasMany(() => QuoteItem)
  declare items: HasMany<typeof QuoteItem>

  @hasMany(() => QuoteFee)
  declare fees: HasMany<typeof QuoteFee>

  @belongsTo(() => Address)
  declare address: BelongsTo<typeof Address>
}
