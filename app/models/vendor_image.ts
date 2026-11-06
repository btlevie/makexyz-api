import { VendorImageSchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Vendor from '#models/vendor'

/** Postgres returns a parsed object for JSON columns, SQLite (tests) a string - same as ModerationEvaluation. */
const jsonColumn = {
  prepare: (value: unknown) =>
    value === null || value === undefined ? value : JSON.stringify(value),
  consume: (value: unknown) =>
    typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
}

/** A vendor's profile photo or portfolio image - see vendor_image_service.ts. */
export default class VendorImage extends VendorImageSchema {
  @column(jsonColumn)
  declare moderationDetails: Record<string, unknown> | null

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>
}
