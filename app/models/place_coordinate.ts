import { PlaceCoordinateSchema } from '#database/schema'

/**
 * Cached coordinates for one Google place (a city), shared by every vendor
 * and city page there. Never kept past Google's 30-day limit - see
 * geocoding_service.ts.
 */
export default class PlaceCoordinate extends PlaceCoordinateSchema {}
