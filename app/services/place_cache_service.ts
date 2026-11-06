/**
 * The per-place coordinate cache (place_coordinates). Google allows
 * coordinates to be kept for at most 30 days, so every row carries an expiry
 * no later than that, an expired row is never read, and
 * RefreshPlaceCoordinates (geocoding_service.ts) re-fetches rows before they
 * expire and deletes any that did. One row per city, shared by every vendor
 * and city page there.
 */
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import vendorSearchConfig from '#config/vendor_search'
import PlaceCoordinate from '#models/place_coordinate'
import { getGeoClient } from '#services/google_geo_client'
import type { LatLng } from '#services/vendor_ranking'

/** Stores (or refreshes) a place's coordinates for the full allowed window. */
export async function cacheCoordinates(
  place: { placeId: string; lat: number; lng: number },
  trx?: TransactionClientContract,
  now = DateTime.now()
): Promise<PlaceCoordinate> {
  return PlaceCoordinate.updateOrCreate(
    { placeId: place.placeId },
    {
      lat: place.lat,
      lng: place.lng,
      refreshedAt: now,
      expiresAt: now.plus({ days: vendorSearchConfig.google.coordinateCacheDays }),
    },
    trx ? { client: trx } : {}
  )
}

/** Unexpired coordinates for each of `placeIds` that has them. */
export async function coordinatesFor(
  placeIds: (string | null)[],
  now = DateTime.now()
): Promise<Map<string, LatLng>> {
  const ids = [...new Set(placeIds.filter((id): id is string => !!id))]
  const found = new Map<string, LatLng>()
  if (ids.length === 0) return found
  const rows = await PlaceCoordinate.query()
    .whereIn('placeId', ids)
    .where('expiresAt', '>', now.toSQL()!)
  for (const row of rows) {
    found.set(row.placeId, { lat: row.lat, lng: row.lng })
  }
  return found
}

/**
 * A place's coordinates from the cache, or looked up once and cached when
 * there's no fresh entry (e.g. a city page that isn't kept warm). Null when
 * Google doesn't know the place or can't be reached.
 */
export async function ensureCoordinates(placeId: string | null): Promise<LatLng | null> {
  if (!placeId) return null
  const found = await coordinatesFor([placeId])
  const cached = found.get(placeId)
  if (cached) return cached

  const client = getGeoClient()
  if (!client.available) return null
  try {
    const result = await client.lookupPlace(placeId)
    if (result.status !== 'ok') return null
    // Cached under the ID we were asked about; a changed ID is picked up by RefreshPlaceIds.
    await cacheCoordinates({ placeId, lat: result.place.lat, lng: result.place.lng })
    return { lat: result.place.lat, lng: result.place.lng }
  } catch (error) {
    logger.warn({ placeId, error: String(error) }, 'Could not look up place coordinates')
    return null
  }
}

/** Removes coordinates past Google's caching limit. */
export async function deleteExpiredCoordinates(now = DateTime.now()): Promise<number> {
  const deleted = await PlaceCoordinate.query().where('expiresAt', '<=', now.toSQL()!).delete()
  return Number(Array.isArray(deleted) ? deleted[0] : deleted) || 0
}
