import { ServiceLocationSchema } from '#database/schema'
import { column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import ServiceLocationPostalCode from '#models/service_location_postal_code'

/** Postgres returns a parsed object for JSON columns, SQLite (tests) a string - same as ModerationEvaluation. */
const jsonColumn = {
  prepare: (value: unknown) =>
    value === null || value === undefined ? value : JSON.stringify(value),
  consume: (value: unknown) =>
    typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
}

/** A city page, keyed by the city's Google place ID - see service_location_service.ts. */
export default class ServiceLocation extends ServiceLocationSchema {
  /** Postgres returns a real boolean, SQLite (tests) 0/1. */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare isIndexable: boolean

  @column(jsonColumn)
  declare servedAreaNames: string[] | null

  @hasMany(() => ServiceLocationPostalCode)
  declare postalCodes: HasMany<typeof ServiceLocationPostalCode>
}
