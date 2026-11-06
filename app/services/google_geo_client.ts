/**
 * Google's Geocoding API (forward, place-ID and reverse lookups) and the
 * Places API (New) place-ID refresh, behind one small interface so tests use
 * an in-memory fake. Everything is at city precision: vendors are located by
 * their city's place ID, never their street address (see
 * docs/plans/manual_quotes.md, 2a).
 *
 * Google's terms shape what's stored: place IDs may be kept indefinitely
 * (refreshed when older than 12 months), coordinates for at most 30 days -
 * geocoding_service.ts enforces both. The key (GOOGLE_GEOCODING_API_KEY)
 * must be restricted to the Geocoding API and the Places API (New).
 */
import env from '#start/env'

const GEOCODE_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json'
const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places'
const TIMEOUT_MS = 5000

/** Place types that count as "the city", most specific first after locality. */
const CITY_TYPES = ['locality', 'postal_town', 'sublocality', 'administrative_area_level_3']

export interface CityQuery {
  city: string
  state: string | null
  postalCode: string | null
  /** ISO 3166-1 alpha-2. */
  country: string
}

/** A place as Google describes it - the address parts are for matching, not display. */
export interface GeoPlace {
  placeId: string
  /** 'locality', 'sublocality', 'postal_code'... */
  placeType: string
  lat: number
  lng: number
  city: string | null
  state: string | null
  country: string | null
  postalCode: string | null
}

export type PlaceLookup = { status: 'ok'; place: GeoPlace } | { status: 'not_found' }

export type PlaceIdRefresh = { status: 'ok'; placeId: string } | { status: 'not_found' }

/** What's at a point: its city (if any) and the postal code containing it. */
export interface ReverseGeocode {
  locality: GeoPlace | null
  postalCode: string | null
  city: string | null
  state: string | null
  country: string | null
}

export interface GeoClient {
  /** False when no API key is configured - nothing is geocoded, and vendors rank on reputation alone. */
  readonly available: boolean
  /**
   * The city's place: its locality, else a sublocality or similar, else the
   * postal code's place. Null when Google has nothing for the address.
   */
  geocodeCity(query: CityQuery): Promise<GeoPlace | null>
  /** Coordinates (and current place ID) for a stored place ID. */
  lookupPlace(placeId: string): Promise<PlaceLookup>
  /** The locality and postal code at a point - the city-page fallback for a search. */
  reverseGeocode(lat: number, lng: number): Promise<ReverseGeocode>
  /** Places API ID-only refresh (no charge): the current ID for a stored one. */
  refreshPlaceId(placeId: string): Promise<PlaceIdRefresh>
}

export class GeoClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeoClientError'
  }
}

interface GoogleComponent {
  long_name: string
  short_name: string
  types: string[]
}

interface GoogleResult {
  place_id: string
  types: string[]
  address_components: GoogleComponent[]
  geometry: { location: { lat: number; lng: number } }
}

function component(result: GoogleResult, type: string, short = false): string | null {
  const found = result.address_components.find((part) => part.types.includes(type))
  return found ? (short ? found.short_name : found.long_name) : null
}

function toPlace(result: GoogleResult): GeoPlace {
  const placeType =
    [...CITY_TYPES, 'postal_code'].find((type) => result.types.includes(type)) ??
    result.types[0] ??
    'unknown'
  return {
    placeId: result.place_id,
    placeType,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    city:
      component(result, 'locality') ??
      component(result, 'postal_town') ??
      component(result, 'sublocality'),
    state: component(result, 'administrative_area_level_1', true),
    country: component(result, 'country', true),
    postalCode: component(result, 'postal_code'),
  }
}

export class GoogleGeoClient implements GeoClient {
  constructor(private readonly apiKey: string | undefined = env.get('GOOGLE_GEOCODING_API_KEY')) {}

  get available() {
    return Boolean(this.apiKey)
  }

  private async geocode(params: Record<string, string>): Promise<GoogleResult[]> {
    if (!this.apiKey) {
      throw new GeoClientError('GOOGLE_GEOCODING_API_KEY is not configured')
    }
    // The Geocoding web service only takes the key as a parameter; the URL is
    // never logged.
    const query = new URLSearchParams({ ...params, key: this.apiKey })
    const response = await fetch(`${GEOCODE_ENDPOINT}?${query}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new GeoClientError(`Geocoding API returned HTTP ${response.status}`)
    }
    const body = (await response.json()) as { status: string; results?: GoogleResult[] }
    if (body.status === 'OK') return body.results ?? []
    // A place ID Google no longer knows comes back as NOT_FOUND or INVALID_REQUEST.
    if (['ZERO_RESULTS', 'NOT_FOUND', 'INVALID_REQUEST'].includes(body.status)) return []
    throw new GeoClientError(`Geocoding API returned ${body.status}`)
  }

  async geocodeCity(query: CityQuery): Promise<GeoPlace | null> {
    const address = [query.city, query.state].filter(Boolean).join(', ')
    const results = await this.geocode({ address, components: `country:${query.country}` })
    for (const type of CITY_TYPES) {
      const match = results.find((result) => result.types.includes(type))
      if (match) return toPlace(match)
    }
    // Unincorporated areas have no locality: fall back to the postal code's place.
    if (query.postalCode) {
      const byPostal = await this.geocode({
        components: `postal_code:${query.postalCode}|country:${query.country}`,
      })
      const match = byPostal.find((result) => result.types.includes('postal_code'))
      if (match) return toPlace(match)
    }
    return null
  }

  async lookupPlace(placeId: string): Promise<PlaceLookup> {
    const results = await this.geocode({ place_id: placeId })
    return results[0] ? { status: 'ok', place: toPlace(results[0]) } : { status: 'not_found' }
  }

  async reverseGeocode(lat: number, lng: number): Promise<ReverseGeocode> {
    const results = await this.geocode({
      latlng: `${lat},${lng}`,
      result_type: [...CITY_TYPES, 'postal_code'].join('|'),
    })
    const localityResult = CITY_TYPES.map((type) =>
      results.find((result) => result.types.includes(type))
    ).find(Boolean)
    const postalResult = results.find((result) => result.types.includes('postal_code'))
    const locality = localityResult ? toPlace(localityResult) : null
    const any = localityResult ?? postalResult
    return {
      locality,
      postalCode: postalResult ? component(postalResult, 'postal_code') : null,
      city: locality?.city ?? (any ? toPlace(any).city : null),
      state: any ? component(any, 'administrative_area_level_1', true) : null,
      country: any ? component(any, 'country', true) : null,
    }
  }

  async refreshPlaceId(placeId: string): Promise<PlaceIdRefresh> {
    if (!this.apiKey) {
      throw new GeoClientError('GOOGLE_GEOCODING_API_KEY is not configured')
    }
    const response = await fetch(`${PLACES_ENDPOINT}/${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'id' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 404 || response.status === 400) {
      return { status: 'not_found' }
    }
    if (!response.ok) {
      throw new GeoClientError(`Places API returned HTTP ${response.status}`)
    }
    const body = (await response.json()) as { id?: string }
    return body.id ? { status: 'ok', placeId: body.id } : { status: 'not_found' }
  }
}

function cityKey(city: string, state: string | null, country: string) {
  return [city, state ?? '', country].map((part) => part.trim().toLowerCase()).join('|')
}

/** Rounds to the precision searches are resolved at, so the fake can key on it. */
function pointKey(lat: number, lng: number) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`
}

/** In-memory stand-in for tests: only the places it was told about exist. */
export class FakeGeoClient implements GeoClient {
  available = true
  failing = false
  readonly cities = new Map<string, GeoPlace>()
  readonly places = new Map<string, GeoPlace>()
  readonly points = new Map<string, ReverseGeocode>()
  /** Place IDs Google has replaced: old -> new. */
  readonly renamed = new Map<string, string>()
  readonly calls: string[] = []

  /** Registers a city (and its place ID) the fake can geocode. */
  addCity(place: GeoPlace & { city: string; country: string }) {
    this.cities.set(cityKey(place.city, place.state, place.country), place)
    this.places.set(place.placeId, place)
    return place
  }

  /** Registers what a reverse geocode of this point returns. */
  addPoint(lat: number, lng: number, result: ReverseGeocode) {
    this.points.set(pointKey(lat, lng), result)
  }

  private call(name: string) {
    this.calls.push(name)
    if (this.failing) throw new GeoClientError('Google unavailable (fake)')
  }

  async geocodeCity(query: CityQuery): Promise<GeoPlace | null> {
    this.call('geocodeCity')
    return this.cities.get(cityKey(query.city, query.state, query.country)) ?? null
  }

  async lookupPlace(placeId: string): Promise<PlaceLookup> {
    this.call('lookupPlace')
    const current = this.renamed.get(placeId) ?? placeId
    const place = this.places.get(current)
    return place ? { status: 'ok', place } : { status: 'not_found' }
  }

  async reverseGeocode(lat: number, lng: number): Promise<ReverseGeocode> {
    this.call('reverseGeocode')
    return (
      this.points.get(pointKey(lat, lng)) ?? {
        locality: null,
        postalCode: null,
        city: null,
        state: null,
        country: null,
      }
    )
  }

  async refreshPlaceId(placeId: string): Promise<PlaceIdRefresh> {
    this.call('refreshPlaceId')
    const current = this.renamed.get(placeId) ?? placeId
    return this.places.has(current) ? { status: 'ok', placeId: current } : { status: 'not_found' }
  }

  reset() {
    this.available = true
    this.failing = false
    this.cities.clear()
    this.places.clear()
    this.points.clear()
    this.renamed.clear()
    this.calls.length = 0
  }
}

export const fakeGeoClient = new FakeGeoClient()

let client: GeoClient | null = null

export function getGeoClient(): GeoClient {
  if (env.get('NODE_ENV') === 'test') {
    return fakeGeoClient
  }
  client ??= new GoogleGeoClient()
  return client
}
