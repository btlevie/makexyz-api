/**
 * The public vendor directory search (docs/plans/manual_quotes.md, 2a).
 * Straight against the database - no search engine, index or sync:
 *
 * 1. Filter listed vendors in SQL by service, technology and material.
 * 2. Join each vendor's city coordinates (place_coordinates, unexpired), and
 *    compute the haversine distance and the legacy score in code
 *    (vendor_ranking.ts) over every match - the ranking depends on all of
 *    them, and a few thousand vendors is one indexed query and a fast loop.
 * 3. Sort (score, then rating count, then uuid, so pages are stable), drop
 *    scores below the floor, paginate, and on the first page of an
 *    unfiltered located search insert one newcomer at position 5.
 *
 * Results are always ranked around the searched point; the city page only
 * decides the title and canonical link. No coordinates or street address
 * ever leave this service - only the vendor's city and a rounded distance.
 */
import db from '@adonisjs/lucid/services/db'
import vendorSearchConfig from '#config/vendor_search'
import Material from '#models/material'
import Vendor from '#models/vendor'
import { coordinatesFor } from '#services/place_cache_service'
import { recordSearchEvent } from '#services/search_analytics_service'
import {
  resolveLocation,
  type LocationInput,
  type ResolvedLocation,
} from '#services/service_location_service'
import {
  loadDirectoryData,
  whereListed,
  type DirectoryData,
} from '#services/vendor_profile_service'
import {
  haversineKm,
  KM_PER_MILE,
  responseTimeGroup,
  score,
  type ResponseTimeGroup,
} from '#services/vendor_ranking'
import type VendorTechnologyCapability from '#models/vendor_technology_capability'

export const SEARCH_SERVICES = ['printing', 'design', 'scanning', 'cnc'] as const
export type SearchService = (typeof SEARCH_SERVICES)[number]

export class UnknownMaterialError extends Error {
  constructor() {
    super('Unknown material')
    this.name = 'UnknownMaterialError'
  }
}

export interface SearchInput extends LocationInput {
  /** What the searcher typed or picked - logged, never used to match. */
  query?: string | null
  service?: SearchService | null
  technology?: VendorTechnologyCapability['technology'] | null
  materialUuid?: string | null
  maxDistanceMiles?: number | null
  page?: number
  perPage?: number
  sessionKey?: string | null
}

export interface DirectoryCard extends DirectoryData {
  vendor: Vendor
  distanceMiles: number | null
  distanceKm: number | null
  responseTime: ResponseTimeGroup | null
  /** The newcomer inserted at position 5 - shown on its own merits again later in the list. */
  featuredNewcomer: boolean
}

export interface SearchResult {
  cards: DirectoryCard[]
  total: number
  page: number
  perPage: number
  location: ResolvedLocation
}

interface Scored {
  vendor: Vendor
  distanceKm: number | null
  score: number
}

function compareScored(a: Scored, b: Scored): number {
  return (
    b.score - a.score ||
    b.vendor.ratingCount - a.vendor.ratingCount ||
    a.vendor.uuid.localeCompare(b.vendor.uuid)
  )
}

/** Listed vendors matching the filters - the SQL half. */
async function candidates(input: SearchInput): Promise<Vendor[]> {
  const query = whereListed(Vendor.query())

  const approvedCapability = (technology?: string) =>
    db
      .from('vendor_technology_capabilities')
      .whereRaw('vendor_technology_capabilities.vendor_id = vendors.id')
      .where('vendor_technology_capabilities.status', 'approved')
      .if(technology, (sub) => sub.where('vendor_technology_capabilities.technology', technology!))

  if (input.technology) {
    query.whereExists(approvedCapability(input.technology))
  }
  if (input.materialUuid) {
    const material = await Material.findBy('uuid', input.materialUuid)
    if (!material) throw new UnknownMaterialError()
    // Approved to make it: a payout rate for the material, and its technology approved.
    query
      .whereExists(
        db
          .from('vendor_payout_rates')
          .whereRaw('vendor_payout_rates.vendor_id = vendors.id')
          .where('vendor_payout_rates.material_id', material.id)
      )
      .whereExists(approvedCapability(material.technology))
  }
  if (input.service === 'printing') {
    query.whereExists(approvedCapability())
  } else if (input.service) {
    query.whereExists(
      db
        .from('vendor_services')
        .whereRaw('vendor_services.vendor_id = vendors.id')
        .where('vendor_services.service', input.service)
        .where('vendor_services.active', true)
        .whereNull('vendor_services.admin_disabled_at')
    )
  }
  return query
}

/** Distance and score for every candidate, dropping scores below the floor. */
async function rank(
  vendors: Vendor[],
  location: ResolvedLocation,
  maxDistanceMiles: number | null
): Promise<Scored[]> {
  const coordinates = await coordinatesFor(vendors.map((vendor) => vendor.placeId))
  const scored: Scored[] = []
  for (const vendor of vendors) {
    const point = vendor.placeId ? coordinates.get(vendor.placeId) : undefined
    const distanceKm = location.center && point ? haversineKm(location.center, point) : null
    if (maxDistanceMiles !== null) {
      if (distanceKm === null || distanceKm / KM_PER_MILE > maxDistanceMiles) continue
    }
    const value = score({
      ratingAverage: vendor.ratingAverage === null ? null : Number(vendor.ratingAverage),
      ratingCount: vendor.ratingCount,
      responseRate: vendor.responseRate,
      distanceKm,
    })
    if (value < vendorSearchConfig.ranking.minimumScore) continue
    scored.push({ vendor, distanceKm, score: value })
  }
  return scored.sort(compareScored)
}

/**
 * Legacy get_noob: one random unrated vendor within 25 miles, with an unknown
 * or perfect response rate, that isn't already on the page.
 */
function pickNewcomer(all: Scored[], onPage: Scored[], random: () => number): Scored | null {
  const shown = new Set(onPage.map((entry) => entry.vendor.id))
  const maxKm = vendorSearchConfig.newcomer.maxDistanceMiles * KM_PER_MILE
  const eligible = all.filter(
    (entry) =>
      !shown.has(entry.vendor.id) &&
      entry.distanceKm !== null &&
      entry.distanceKm <= maxKm &&
      entry.vendor.ratingCount === 0 &&
      (entry.vendor.responseRate === null || entry.vendor.responseRate === 100)
  )
  if (eligible.length === 0) return null
  return eligible[Math.floor(random() * eligible.length)] ?? null
}

export async function searchVendors(
  input: SearchInput,
  context: { customerId: number | null; random?: () => number } = { customerId: null }
): Promise<SearchResult> {
  const { defaultPerPage, maxPerPage } = vendorSearchConfig.pagination
  const perPage = Math.min(Math.max(1, input.perPage ?? defaultPerPage), maxPerPage)
  const page = Math.max(1, input.page ?? 1)

  const location = await resolveLocation(input)
  const ranked = await rank(await candidates(input), location, input.maxDistanceMiles ?? null)

  const start = (page - 1) * perPage
  const onPage = ranked.slice(start, start + perPage)
  const pageEntries = onPage.map((entry) => ({ entry, featured: false }))

  const unfiltered = !input.service && !input.technology && !input.materialUuid
  if (page === 1 && unfiltered && location.center) {
    const newcomer = pickNewcomer(ranked, onPage, context.random ?? Math.random)
    if (newcomer) {
      const index = Math.min(vendorSearchConfig.newcomer.position - 1, pageEntries.length)
      pageEntries.splice(index, 0, { entry: newcomer, featured: true })
    }
  }

  const directory = await loadDirectoryData(pageEntries.map(({ entry }) => entry.vendor.id))
  const cards: DirectoryCard[] = pageEntries.map(({ entry, featured }) => ({
    ...directory.get(entry.vendor.id)!,
    vendor: entry.vendor,
    distanceKm: entry.distanceKm === null ? null : Math.round(entry.distanceKm),
    distanceMiles: entry.distanceKm === null ? null : Math.round(entry.distanceKm / KM_PER_MILE),
    responseTime: responseTimeGroup(entry.vendor.responseTimeHours),
    featuredNewcomer: featured,
  }))

  const searcherPoint =
    typeof input.lat === 'number' && typeof input.lng === 'number'
      ? { lat: input.lat, lng: input.lng }
      : null
  if (page === 1)
    await recordSearchEvent({
      rawQuery: input.query ?? null,
      location,
      searcherPoint,
      service: input.service ?? null,
      filters: {
        technology: input.technology ?? null,
        materialUuid: input.materialUuid ?? null,
        maxDistanceMiles: input.maxDistanceMiles ?? null,
        locationSlug: input.locationSlug ?? null,
        page,
      },
      resultCount: ranked.length,
      sessionKey: input.sessionKey ?? null,
      customerId: context.customerId,
    })

  return { cards, total: ranked.length, page, perPage, location }
}
