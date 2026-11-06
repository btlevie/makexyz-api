import { VendorServiceSchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Vendor from '#models/vendor'

/** A non-printing service a vendor offers (design, scanning, CNC). */
export default class VendorService extends VendorServiceSchema {
  /** Postgres returns a real boolean, SQLite (tests) 0/1. */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare active: boolean

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>

  /** Shown in the directory: on, and not turned off by an admin. */
  get isListed(): boolean {
    return this.active && this.adminDisabledAt === null
  }
}
