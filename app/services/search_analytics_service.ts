/**
 * Demand logging for the city-page SEO loop (docs/plans/manual_quotes.md,
 * 2g): every directory search, and visitors landing on a page. Both are best
 * effort - a logging failure never fails the search or the page.
 *
 * Search coordinates are kept at 2 decimal places (about 1 km) and nulled
 * after 30 days (PurgeSearchEventCoordinates); the matched and canonical
 * city pages are worked out at search time, so nothing needs them later.
 */
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import vendorSearchConfig from '#config/vendor_search'
import LandingPageVisit from '#models/landing_page_visit'
import SearchEvent from '#models/search_event'
import type { ResolvedLocation } from '#services/service_location_service'
import { roundCoordinate } from '#services/vendor_ranking'

export interface SearchEventInput {
  rawQuery: string | null
  location: ResolvedLocation
  /** The searcher's own coordinates, if they gave any (not a city page's center). */
  searcherPoint: { lat: number; lng: number } | null
  service: string | null
  filters: Record<string, unknown>
  resultCount: number
  sessionKey: string | null
  customerId: number | null
}

export async function recordSearchEvent(input: SearchEventInput): Promise<void> {
  const decimals = vendorSearchConfig.search.loggedCoordinateDecimals
  const { location } = input
  const canonical =
    location.canonical &&
    location.canonical.id !== location.matched?.id &&
    (location.canonicalMiles === null ||
      location.canonicalMiles <= vendorSearchConfig.search.canonicalMaxMiles)
      ? location.canonical
      : null
  try {
    await SearchEvent.create({
      rawQuery: input.rawQuery?.slice(0, 255) ?? null,
      placeId: location.place.placeId,
      localityPlaceId: location.place.localityPlaceId,
      city: location.place.city,
      state: location.place.state,
      country: location.place.country,
      postalCode: location.place.postalCode,
      lat: input.searcherPoint ? roundCoordinate(input.searcherPoint.lat, decimals) : null,
      lng: input.searcherPoint ? roundCoordinate(input.searcherPoint.lng, decimals) : null,
      matchedLocationId: location.matched?.id ?? null,
      canonicalLocationId: canonical?.id ?? null,
      service: input.service,
      filters: input.filters,
      resultCount: input.resultCount,
      sessionKey: input.sessionKey,
      customerId: input.customerId,
    })
  } catch (error) {
    logger.warn({ error: String(error) }, 'Failed to record a search event')
  }
}

/** Is `referrer` one of our own pages (a navigation, not an arrival)? */
function isInternal(referrer: string | null, ownHosts: string[]): boolean {
  if (!referrer) return false
  try {
    const host = new URL(referrer).hostname.toLowerCase()
    return ownHosts.some((own) => host === own || host.endsWith(`.${own}`))
  } catch {
    return false
  }
}

export async function recordLandingVisit(input: {
  path: string
  referrer: string | null
  sessionKey: string | null
  ownHosts: string[]
}): Promise<void> {
  try {
    await LandingPageVisit.create({
      path: input.path.slice(0, 512),
      referrer: input.referrer?.slice(0, 512) ?? null,
      isInternalReferrer: isInternal(input.referrer, input.ownHosts),
      sessionKey: input.sessionKey,
    })
  } catch (error) {
    logger.warn({ error: String(error) }, 'Failed to record a landing page visit')
  }
}

/** Nulls coordinates on search events older than the retention window. */
export async function purgeSearchEventCoordinates(now = DateTime.now()): Promise<number> {
  const cutoff = now.minus({ days: vendorSearchConfig.search.searchEventCoordinateDays })
  const updated = await SearchEvent.query()
    .where('createdAt', '<', cutoff.toSQL()!)
    .where((query) => query.whereNotNull('lat').orWhereNotNull('lng'))
    .update({ lat: null, lng: null })
  return Number(Array.isArray(updated) ? updated[0] : updated) || 0
}
