/**
 * Locating vendors, and keeping what we store from Google within its terms
 * (docs/plans/manual_quotes.md, 2a):
 * - a vendor is geocoded from its default business address's city, state and
 *   country to the city's place ID (GeocodeVendor, queued whenever that
 *   address changes);
 * - coordinates are cached per place for at most 30 days
 *   (place_cache_service.ts) and refreshed daily before they expire
 *   (RefreshPlaceCoordinates);
 * - place IDs older than 12 months are refreshed monthly with Google's free
 *   ID-only lookup (RefreshPlaceIds). A place Google no longer knows is
 *   re-geocoded from the stored city.
 */
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import vendorSearchConfig from '#config/vendor_search'
import Address from '#models/address'
import PlaceCoordinate from '#models/place_coordinate'
import ServiceLocation from '#models/service_location'
import Vendor from '#models/vendor'
import GeocodeVendor from '#jobs/geocode_vendor'
import { getGeoClient } from '#services/google_geo_client'
import { cacheCoordinates, deleteExpiredCoordinates } from '#services/place_cache_service'
import { ensureCityPageForVendor } from '#services/service_location_service'

/** The vendor's default business address - the one onboarding requires. */
export async function defaultVendorAddress(vendorId: number): Promise<Address | null> {
  return Address.query()
    .where('vendorId', vendorId)
    .where('ownerType', 'vendor')
    .where('isDefault', true)
    .first()
}

/** Queues a (re-)geocode of the vendor. Best effort: a failure to queue is logged. */
export async function queueGeocode(vendorId: number): Promise<void> {
  try {
    await GeocodeVendor.dispatch({ vendorId })
      .dedup({ id: `geocode-vendor-${vendorId}`, ttl: '30s' })
      .run()
  } catch (error) {
    logger.error({ vendorId, error: String(error) }, 'Failed to queue vendor geocode')
  }
}

/**
 * Geocodes the vendor from its default address. The public city/state/country
 * are copied from the vendor's own address whatever Google says, so the
 * profile shows a location even before (or without) geocoding.
 */
export async function geocodeVendor(vendor: Vendor): Promise<Vendor> {
  const address = await defaultVendorAddress(vendor.id)
  if (!address) {
    vendor.merge({
      placeId: null,
      placeType: null,
      placeIdRefreshedAt: null,
      geocodeStatus: 'pending',
      locationCity: null,
      locationState: null,
      locationCountry: null,
      locationPostalCode: null,
    })
    await vendor.save()
    return vendor
  }

  const location = {
    locationCity: address.city,
    locationState: address.state,
    locationCountry: address.country.toUpperCase().slice(0, 2),
    locationPostalCode: address.postalCode,
  }
  const unchanged =
    vendor.geocodeStatus === 'ok' &&
    vendor.placeId !== null &&
    (Object.keys(location) as (keyof typeof location)[]).every(
      (key) => vendor[key] === location[key]
    )
  if (unchanged) {
    // Same city as last time (e.g. only the street changed) - nothing to ask Google.
    return vendor
  }
  vendor.merge(location)

  const client = getGeoClient()
  if (!client.available) {
    vendor.geocodeStatus = 'pending'
    await vendor.save()
    return vendor
  }

  const place = await client
    .geocodeCity({
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: vendor.locationCountry!,
    })
    .catch(async (error) => {
      // Saved as failed, then rethrown so the job retries.
      logger.warn({ vendorUuid: vendor.uuid, error: String(error) }, 'Vendor geocode failed')
      vendor.geocodeStatus = 'failed'
      await vendor.save()
      throw error
    })

  if (!place) {
    vendor.merge({
      placeId: null,
      placeType: null,
      placeIdRefreshedAt: null,
      geocodeStatus: 'not_found',
    })
    await vendor.save()
    return vendor
  }

  const now = DateTime.now()
  await db.transaction(async (trx) => {
    vendor.useTransaction(trx)
    vendor.merge({
      placeId: place.placeId,
      placeType: place.placeType,
      placeIdRefreshedAt: now,
      geocodeStatus: 'ok',
    })
    await vendor.save()
    await cacheCoordinates(place, trx, now)
    await ensureCityPageForVendor(vendor, trx)
  })
  return vendor
}

/** Moves every reference from a place ID Google replaced to its new one. */
async function replacePlaceId(oldId: string, newId: string, now: DateTime) {
  await db.transaction(async (trx) => {
    await Vendor.query({ client: trx })
      .where('placeId', oldId)
      .update({ place_id: newId, place_id_refreshed_at: now.toSQL() })
    const clash = await ServiceLocation.query({ client: trx }).where('placeId', newId).first()
    if (!clash) {
      await ServiceLocation.query({ client: trx })
        .where('placeId', oldId)
        .update({ place_id: newId, place_id_refreshed_at: now.toSQL() })
    }
    await PlaceCoordinate.query({ client: trx }).where('placeId', oldId).delete()
  })
}

/** Google no longer knows a place: re-geocode everything that used it from the stored city. */
async function handlePlaceNotFound(placeId: string) {
  await PlaceCoordinate.query().where('placeId', placeId).delete()
  const vendors = await Vendor.query().where('placeId', placeId)
  for (const vendor of vendors) {
    await queueGeocode(vendor.id)
  }
  const client = getGeoClient()
  const pages = await ServiceLocation.query().where('placeId', placeId)
  for (const page of pages) {
    const place = await client.geocodeCity({
      city: page.city,
      state: page.state,
      postalCode: null,
      country: page.country,
    })
    const taken = place
      ? await ServiceLocation.query().where('placeId', place.placeId).first()
      : null
    page.merge({
      placeId: place && !taken ? place.placeId : null,
      placeIdRefreshedAt: place && !taken ? DateTime.now() : null,
    })
    await page.save()
    if (place && !taken) await cacheCoordinates(place)
  }
}

/** Place IDs whose coordinates are needed: every geocoded vendor and every indexable city page. */
async function placeIdsInUse(): Promise<string[]> {
  const [vendors, pages] = await Promise.all([
    Vendor.query().whereNotNull('placeId').distinct('place_id').select('place_id'),
    ServiceLocation.query().where('isIndexable', true).whereNotNull('placeId').select('place_id'),
  ])
  return [
    ...new Set([...vendors, ...pages].map((row) => row.placeId).filter((id): id is string => !!id)),
  ]
}

export interface RefreshResult {
  refreshed: number
  replaced: number
  notFound: number
  failed: number
  deleted: number
}

/**
 * Daily: re-fetches coordinates for every place in use whose entry is missing
 * or expires within `coordinateRefreshAheadDays`, and deletes entries past
 * Google's limit. A failure leaves that place uncached (vendors there rank on
 * reputation alone) until the next run.
 */
export async function refreshPlaceCoordinates(now = DateTime.now()): Promise<RefreshResult> {
  const result: RefreshResult = { refreshed: 0, replaced: 0, notFound: 0, failed: 0, deleted: 0 }
  result.deleted = await deleteExpiredCoordinates(now)

  const client = getGeoClient()
  if (!client.available) return result

  const ids = await placeIdsInUse()
  const horizon = now.plus({ days: vendorSearchConfig.google.coordinateRefreshAheadDays })
  const freshRows = await PlaceCoordinate.query()
    .whereIn('placeId', ids.length > 0 ? ids : [''])
    .where('expiresAt', '>', horizon.toSQL()!)
    .select('place_id')
  const fresh = new Set(freshRows.map((row) => row.placeId))

  for (const placeId of ids.filter((id) => !fresh.has(id))) {
    try {
      const lookup = await client.lookupPlace(placeId)
      if (lookup.status === 'not_found') {
        await handlePlaceNotFound(placeId)
        result.notFound++
        continue
      }
      if (lookup.place.placeId !== placeId) {
        await replacePlaceId(placeId, lookup.place.placeId, now)
        result.replaced++
      }
      await cacheCoordinates(lookup.place, undefined, now)
      result.refreshed++
    } catch (error) {
      result.failed++
      logger.warn({ placeId, error: String(error) }, 'Place coordinate refresh failed')
    }
  }
  return result
}

/**
 * Monthly: refreshes stored place IDs older than `placeIdRefreshMonths`
 * (vendors, city pages) with Google's free ID-only lookup. A changed ID is
 * updated everywhere; a NOT_FOUND re-geocodes from the stored city.
 */
export async function refreshPlaceIds(now = DateTime.now()): Promise<RefreshResult> {
  const result: RefreshResult = { refreshed: 0, replaced: 0, notFound: 0, failed: 0, deleted: 0 }
  const client = getGeoClient()
  if (!client.available) return result

  const cutoff = now.minus({ months: vendorSearchConfig.google.placeIdRefreshMonths }).toSQL()!
  const stale = (query: any) =>
    query
      .whereNotNull('placeId')
      .where((inner: any) =>
        inner.whereNull('placeIdRefreshedAt').orWhere('placeIdRefreshedAt', '<', cutoff)
      )
  const [vendors, pages] = await Promise.all([
    stale(Vendor.query()).select('place_id') as Promise<Vendor[]>,
    stale(ServiceLocation.query()).select('place_id') as Promise<ServiceLocation[]>,
  ])
  const ids = [
    ...new Set([...vendors, ...pages].map((row) => row.placeId).filter((id): id is string => !!id)),
  ]

  for (const placeId of ids) {
    try {
      const refreshed = await client.refreshPlaceId(placeId)
      if (refreshed.status === 'not_found') {
        await handlePlaceNotFound(placeId)
        result.notFound++
        continue
      }
      if (refreshed.placeId !== placeId) {
        await replacePlaceId(placeId, refreshed.placeId, now)
        result.replaced++
      } else {
        await Vendor.query()
          .where('placeId', placeId)
          .update({ place_id_refreshed_at: now.toSQL() })
        await ServiceLocation.query()
          .where('placeId', placeId)
          .update({ place_id_refreshed_at: now.toSQL() })
      }
      result.refreshed++
    } catch (error) {
      result.failed++
      logger.warn({ placeId, error: String(error) }, 'Place ID refresh failed')
    }
  }
  return result
}
