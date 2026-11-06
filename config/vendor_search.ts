/**
 * Vendor directory constants - ranking, the newcomer boost, the price
 * indicator, response-time groups and Google caching limits. The values are
 * the legacy app's (makexyz/elastic/search_query.py, xyz/search/services.py,
 * xyz/search/mysql_backend.py); see docs/plans/manual_quotes.md, section 2.
 */
const vendorSearchConfig = {
  ranking: {
    /** ratingTier by rounded average rating; `unrated` when there are no ratings. */
    ratingTiers: { five: 1.2, four: 1.13, threeOrLess: 0.9, unrated: 1.05 },
    /** volume = min(volumeCap, 1 + ratingCount / volumeDivisor). */
    volumeDivisor: 100,
    volumeCap: 1.5,
    /** proximity = exp(ln(0.5) * max(0, km - proximityOffsetKm) / proximityScaleKm). */
    proximityOffsetKm: 10,
    proximityScaleKm: 1000,
    scoreMultiplier: 10,
    /** Results scoring below this are dropped. */
    minimumScore: 1,
  },
  newcomer: {
    /** Inserted at this 1-based position on the first page. */
    position: 5,
    maxDistanceMiles: 25,
  },
  pagination: { defaultPerPage: 20, maxPerPage: 50 },
  /** priceTier from the vendor's cheapest indicative price per cm3: below each bound -> that tier, else 4. */
  priceTierBounds: [0.49, 1.49, 3.24],
  /** Response time groups, by median hours: within a few hours / within a day / a few days. */
  responseTimeHours: { withinHours: 6, withinDay: 24 },
  response: {
    windowDays: 90,
    /** A reply (or decline) within this many days counts as a response. */
    responseDays: 7,
    /** The median is over this many most recent responded inquiries. */
    timeSampleSize: 6,
  },
  google: {
    /** Google allows coordinates to be cached for at most 30 days. */
    coordinateCacheDays: 30,
    /** RefreshPlaceCoordinates re-fetches entries expiring within this many days. */
    coordinateRefreshAheadDays: 5,
    /** Google recommends refreshing stored place IDs older than this. */
    placeIdRefreshMonths: 12,
  },
  search: {
    /** Searcher coordinates are rounded to this many decimals (about 100 m) before use. */
    coordinateDecimals: 3,
    /** search_events keep coordinates at this precision (about 1 km), and only for searchEventCoordinateDays. */
    loggedCoordinateDecimals: 2,
    searchEventCoordinateDays: 30,
    /** A search's canonical city page is the nearest indexable one within this distance. */
    canonicalMaxMiles: 50,
  },
}

export default vendorSearchConfig
