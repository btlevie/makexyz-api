/**
 * City pages ("3D printers in Austin") and resolving a search to one. See
 * docs/plans/manual_quotes.md, 2c.
 *
 * A city page is stored by its city's Google place ID plus the postal codes
 * inside it, never by coordinates. A search is resolved to a page by, in
 * order: the place ID the customer picked, its postal code, its city + state
 * + country, and finally a reverse geocode of the coordinates (which also
 * teaches the page that postal code). The page only decides the title, URL
 * and canonical link - which vendors come back is always "nearest to the
 * searched point, ranked by the formula" (vendor_search_service.ts).
 */
import string from '@adonisjs/core/helpers/string'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import vendorSearchConfig from '#config/vendor_search'
import ServiceLocation from '#models/service_location'
import ServiceLocationPostalCode from '#models/service_location_postal_code'
import type Vendor from '#models/vendor'
import { getGeoClient, type ReverseGeocode } from '#services/google_geo_client'
import { coordinatesFor, ensureCoordinates } from '#services/place_cache_service'
import { haversineKm, KM_PER_MILE, roundCoordinate, type LatLng } from '#services/vendor_ranking'

export class LocationNotFoundError extends Error {
  constructor() {
    super('Location not found')
    this.name = 'LocationNotFoundError'
  }
}

/** What the searcher gave us - from a Google Places pick, browser geolocation, or a city page slug. */
export interface LocationInput {
  lat?: number | null
  lng?: number | null
  placeId?: string | null
  postalCode?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  locationSlug?: string | null
}

/** The searched place, described for the page title and the search log. */
export interface SearchedPlace {
  placeId: string | null
  localityPlaceId: string | null
  city: string | null
  state: string | null
  country: string | null
  postalCode: string | null
}

export interface ResolvedLocation {
  /** The point vendors are ranked around; null = reputation only. */
  center: LatLng | null
  /** The city page the search resolved to, if there is one. */
  matched: ServiceLocation | null
  /** The nearest indexable city page - the canonical link (the match itself, when indexable). */
  canonical: ServiceLocation | null
  /** Distance from the center to the canonical page, when both are known. */
  canonicalMiles: number | null
  place: SearchedPlace
}

function normalizeCountry(country: string | null | undefined): string | null {
  const trimmed = country?.trim().toUpperCase()
  return trimmed && trimmed.length === 2 ? trimmed : null
}

function normalizePostal(postalCode: string | null | undefined): string | null {
  const trimmed = postalCode?.trim().toUpperCase().replace(/\s+/g, ' ')
  return trimmed || null
}

export async function findByPlaceId(
  placeId: string | null | undefined,
  trx?: TransactionClientContract
): Promise<ServiceLocation | null> {
  if (!placeId) return null
  return ServiceLocation.query(trx ? { client: trx } : {})
    .where('placeId', placeId)
    .first()
}

export async function findByPostalCode(
  country: string | null | undefined,
  postalCode: string | null | undefined
): Promise<ServiceLocation | null> {
  const normalizedCountry = normalizeCountry(country)
  const normalizedPostal = normalizePostal(postalCode)
  if (!normalizedCountry || !normalizedPostal) return null
  const mapping = await ServiceLocationPostalCode.query()
    .where('country', normalizedCountry)
    .where('postalCode', normalizedPostal)
    .preload('serviceLocation')
    .first()
  return mapping?.serviceLocation ?? null
}

/** Case-insensitive match on city + state + country (state may be absent outside the US). */
export async function findByCity(
  city: string | null | undefined,
  state: string | null | undefined,
  country: string | null | undefined,
  trx?: TransactionClientContract
): Promise<ServiceLocation | null> {
  const normalizedCountry = normalizeCountry(country)
  if (!city?.trim() || !normalizedCountry) return null
  return ServiceLocation.query(trx ? { client: trx } : {})
    .where('country', normalizedCountry)
    .whereRaw('lower(city) = ?', [city.trim().toLowerCase()])
    .whereRaw("lower(coalesce(state, '')) = ?", [(state ?? '').trim().toLowerCase()])
    .first()
}

/** A unique slug like `austin-tx`, `toronto-on` or `lyon-fr`. */
async function uniqueSlug(
  city: string,
  state: string | null,
  country: string,
  trx?: TransactionClientContract
): Promise<string> {
  const base =
    string.slug(`${city} ${state ?? country}`, { lower: true, strict: true }).slice(0, 100) ||
    'city'
  let candidate = base
  for (let suffix = 2; ; suffix++) {
    const taken = await ServiceLocation.query(trx ? { client: trx } : {})
      .where('slug', candidate)
      .first()
    if (!taken) return candidate
    candidate = `${base}-${suffix}`
  }
}

/** Records that a postal code lies in a city page's city. A code already mapped elsewhere is left alone. */
export async function addPostalCode(
  location: ServiceLocation,
  country: string | null | undefined,
  postalCode: string | null | undefined,
  trx?: TransactionClientContract
): Promise<void> {
  const normalizedCountry = normalizeCountry(country)
  const normalizedPostal = normalizePostal(postalCode)
  if (!normalizedCountry || !normalizedPostal) return
  const options = trx ? { client: trx } : {}
  const existing = await ServiceLocationPostalCode.query(options)
    .where('country', normalizedCountry)
    .where('postalCode', normalizedPostal)
    .first()
  if (existing) return
  try {
    await ServiceLocationPostalCode.create(
      {
        serviceLocationId: location.id,
        country: normalizedCountry,
        postalCode: normalizedPostal,
      },
      options
    )
  } catch (error) {
    // A concurrent insert of the same code - either mapping is fine.
    logger.debug({ error: String(error) }, 'Postal code already mapped')
  }
}

/**
 * Makes sure a geocoded vendor's city has a page (created non-indexable,
 * until the scoring job promotes it) and that the vendor's postal code maps
 * to it. The name comes from the vendor's own address (user data), the key
 * from Google's place ID.
 */
export async function ensureCityPageForVendor(
  vendor: Vendor,
  trx?: TransactionClientContract
): Promise<ServiceLocation | null> {
  if (!vendor.placeId || !vendor.locationCity || !vendor.locationCountry) return null
  const options = trx ? { client: trx } : {}

  let location = await findByPlaceId(vendor.placeId, trx)
  if (!location) {
    // An imported page for this city that hasn't been geocoded yet adopts the place ID.
    const byCity = await findByCity(
      vendor.locationCity,
      vendor.locationState,
      vendor.locationCountry,
      trx
    )
    if (byCity && !byCity.placeId) {
      if (trx) byCity.useTransaction(trx)
      byCity.merge({ placeId: vendor.placeId, placeIdRefreshedAt: vendor.placeIdRefreshedAt })
      await byCity.save()
      location = byCity
    } else if (!byCity) {
      location = await ServiceLocation.create(
        {
          slug: await uniqueSlug(
            vendor.locationCity,
            vendor.locationState,
            vendor.locationCountry,
            trx
          ),
          city: vendor.locationCity,
          state: vendor.locationState,
          country: vendor.locationCountry,
          placeId: vendor.placeId,
          placeIdRefreshedAt: vendor.placeIdRefreshedAt,
          isIndexable: false,
          nearbyVendorCount: 0,
          searchDemand: 0,
          recentOrders: 0,
        },
        options
      )
    } else {
      // Same city name under a different place ID (Google's IDs for one
      // city can differ by endpoint) - keep the existing page.
      location = byCity
    }
  }
  await addPostalCode(location, vendor.locationCountry, vendor.locationPostalCode, trx)
  return location
}

/** Indexable city pages with fresh coordinates, nearest first. */
async function indexableWithCoordinates(): Promise<{ location: ServiceLocation; point: LatLng }[]> {
  const pages = await ServiceLocation.query().where('isIndexable', true).whereNotNull('placeId')
  const coordinates = await coordinatesFor(pages.map((page) => page.placeId))
  return pages.flatMap((location) => {
    const point = location.placeId ? coordinates.get(location.placeId) : undefined
    return point ? [{ location, point }] : []
  })
}

/** The nearest indexable city page to a point (optionally within `maxMiles`). */
export async function nearestIndexable(
  center: LatLng | null,
  maxMiles?: number
): Promise<{ location: ServiceLocation; miles: number } | null> {
  if (!center) return null
  let best: { location: ServiceLocation; miles: number } | null = null
  for (const { location, point } of await indexableWithCoordinates()) {
    const miles = haversineKm(center, point) / KM_PER_MILE
    if (maxMiles !== undefined && miles > maxMiles) continue
    if (!best || miles < best.miles) best = { location, miles }
  }
  return best
}

/** Steps 1-3 of resolution: place ID, postal code, city + state + country. */
async function matchPlace(place: SearchedPlace): Promise<ServiceLocation | null> {
  return (
    (await findByPlaceId(place.localityPlaceId)) ??
    (await findByPlaceId(place.placeId)) ??
    (await findByPostalCode(place.country, place.postalCode)) ??
    (await findByCity(place.city, place.state, place.country))
  )
}

async function reverseGeocode(center: LatLng): Promise<ReverseGeocode | null> {
  const client = getGeoClient()
  if (!client.available) return null
  try {
    return await client.reverseGeocode(center.lat, center.lng)
  } catch (error) {
    logger.warn({ error: String(error) }, 'Reverse geocode failed; searching without a city page')
    return null
  }
}

async function withCanonical(
  center: LatLng | null,
  matched: ServiceLocation | null,
  place: SearchedPlace
): Promise<ResolvedLocation> {
  if (matched?.isIndexable) {
    const point = await ensureCoordinates(matched.placeId)
    return {
      center,
      matched,
      canonical: matched,
      canonicalMiles: center && point ? haversineKm(center, point) / KM_PER_MILE : null,
      place,
    }
  }
  const nearest = await nearestIndexable(center)
  return {
    center,
    matched,
    canonical: nearest?.location ?? null,
    canonicalMiles: nearest?.miles ?? null,
    place,
  }
}

/**
 * Resolves what the searcher gave us to a ranking center, a city page and the
 * canonical page. Throws LocationNotFoundError for an unknown slug.
 */
export async function resolveLocation(input: LocationInput): Promise<ResolvedLocation> {
  if (input.locationSlug) {
    const location = await ServiceLocation.findBy('slug', input.locationSlug)
    if (!location) throw new LocationNotFoundError()
    const center = await ensureCoordinates(location.placeId)
    return withCanonical(center, location, {
      placeId: location.placeId,
      localityPlaceId: location.placeId,
      city: location.city,
      state: location.state,
      country: location.country,
      postalCode: null,
    })
  }

  const decimals = vendorSearchConfig.search.coordinateDecimals
  const center =
    typeof input.lat === 'number' && typeof input.lng === 'number'
      ? { lat: roundCoordinate(input.lat, decimals), lng: roundCoordinate(input.lng, decimals) }
      : null
  const place: SearchedPlace = {
    placeId: input.placeId ?? null,
    localityPlaceId: null,
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    country: normalizeCountry(input.country),
    postalCode: normalizePostal(input.postalCode),
  }

  let matched = await matchPlace(place)
  if (matched) {
    place.localityPlaceId = matched.placeId
  }

  if (!matched && center) {
    // Step 4: what's at this point - its city's place ID and its postal code.
    const reverse = await reverseGeocode(center)
    if (reverse) {
      place.localityPlaceId = reverse.locality?.placeId ?? null
      place.city ??= reverse.city
      place.state ??= reverse.state
      place.country ??= normalizeCountry(reverse.country)
      place.postalCode ??= normalizePostal(reverse.postalCode)
      matched = await matchPlace({
        placeId: null,
        localityPlaceId: reverse.locality?.placeId ?? null,
        city: reverse.city,
        state: reverse.state,
        country: normalizeCountry(reverse.country),
        postalCode: normalizePostal(reverse.postalCode),
      })
      // Learned: this postal code is in that city, so the next search skips Google.
      if (matched && reverse.postalCode) {
        await addPostalCode(matched, reverse.country, reverse.postalCode)
      }
    }
  }

  // No coordinates (a server-rendered page, or parts without a point): rank around the page's city.
  const rankingCenter = center ?? (matched ? await ensureCoordinates(matched.placeId) : null)
  return withCanonical(rankingCenter, matched, place)
}

/** Every indexable city page, for the sitemap and city index. */
export async function listIndexable(): Promise<ServiceLocation[]> {
  return ServiceLocation.query()
    .where('isIndexable', true)
    .orderBy('country', 'asc')
    .orderBy('state', 'asc')
    .orderBy('city', 'asc')
}

/** A city page and, when it isn't indexable itself, the nearest one that is (its canonical target). */
export async function showLocation(
  slug: string
): Promise<{ location: ServiceLocation; nearestIndexable: ServiceLocation | null }> {
  const location = await ServiceLocation.findBy('slug', slug)
  if (!location) throw new LocationNotFoundError()
  if (location.isIndexable) return { location, nearestIndexable: null }
  const nearest = await nearestIndexable(await ensureCoordinates(location.placeId))
  return { location, nearestIndexable: nearest?.location ?? null }
}
