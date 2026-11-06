import { LandingPageVisitSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

/** A visitor landing on a page - see search_analytics_service.ts. */
export default class LandingPageVisit extends LandingPageVisitSchema {
  /** Postgres returns a real boolean, SQLite (tests) 0/1. */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare isInternalReferrer: boolean
}
