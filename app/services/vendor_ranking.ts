/**
 * The directory's ranking formula - pure functions, no I/O. It's the legacy
 * formula (makexyz/elastic/search_query.py) with the review-volume bonus
 * working: the legacy index stored `volume` as an integer, so the bonus never
 * applied (documented in xyz/search/mysql_backend.py). Constants live in
 * config/vendor_search.ts.
 *
 *   reputation = ratingTier * (1 + (volume - 1) / 4) * responseFactor
 *   proximity  = exp(ln(0.5) * max(0, km - 10) / 1000)    (0 without a location)
 *   score      = 10 * (reputation + proximity)             (dropped below 1)
 */
import vendorSearchConfig from '#config/vendor_search'

export interface LatLng {
  lat: number
  lng: number
}

export interface RankingInput {
  ratingAverage: number | null
  ratingCount: number
  /** 0-100, null = unknown. */
  responseRate: number | null
  /** Null when either side has no location. */
  distanceKm: number | null
}

const EARTH_RADIUS_KM = 6371.0088
export const KM_PER_MILE = 1.609344

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function ratingTier(ratingAverage: number | null, ratingCount: number): number {
  const tiers = vendorSearchConfig.ranking.ratingTiers
  if (ratingCount <= 0 || ratingAverage === null) return tiers.unrated
  const rounded = Math.round(ratingAverage)
  if (rounded >= 5) return tiers.five
  if (rounded === 4) return tiers.four
  return tiers.threeOrLess
}

export function volume(ratingCount: number): number {
  const { volumeCap, volumeDivisor } = vendorSearchConfig.ranking
  if (ratingCount <= 0) return 1
  return Math.min(volumeCap, 1 + ratingCount / volumeDivisor)
}

export function responseFactor(responseRate: number | null): number {
  return responseRate === null ? 1 : responseRate / 100
}

export function reputation(input: Omit<RankingInput, 'distanceKm'>): number {
  return (
    ratingTier(input.ratingAverage, input.ratingCount) *
    (1 + (volume(input.ratingCount) - 1) / 4) *
    responseFactor(input.responseRate)
  )
}

export function proximity(distanceKm: number | null): number {
  if (distanceKm === null) return 0
  const { proximityOffsetKm, proximityScaleKm } = vendorSearchConfig.ranking
  return Math.exp((Math.log(0.5) * Math.max(0, distanceKm - proximityOffsetKm)) / proximityScaleKm)
}

export function score(input: RankingInput): number {
  return (
    vendorSearchConfig.ranking.scoreMultiplier * (reputation(input) + proximity(input.distanceKm))
  )
}

/** The "$ to $$$$" indicator from the vendor's cheapest published price per cm3; null without one. */
export function priceTier(cheapestPerCm3: number | null): 1 | 2 | 3 | 4 | null {
  if (cheapestPerCm3 === null) return null
  const [one, two, three] = vendorSearchConfig.priceTierBounds
  if (cheapestPerCm3 < one) return 1
  if (cheapestPerCm3 < two) return 2
  if (cheapestPerCm3 < three) return 3
  return 4
}

export type ResponseTimeGroup = 'within_hours' | 'within_a_day' | 'a_few_days'

/** How the median response time is shown: "within a few hours", "within a day", "a few days". */
export function responseTimeGroup(hours: number | null): ResponseTimeGroup | null {
  if (hours === null) return null
  const { withinHours, withinDay } = vendorSearchConfig.responseTimeHours
  if (hours <= withinHours) return 'within_hours'
  if (hours <= withinDay) return 'within_a_day'
  return 'a_few_days'
}

/** Rounds a coordinate to `decimals` places (3 = about 100 m, 2 = about 1 km). */
export function roundCoordinate(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
