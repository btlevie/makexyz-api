import string from '@adonisjs/core/helpers/string'
import User from '#models/user'
import Vendor from '#models/vendor'
import VendorTechnologyCapability from '#models/vendor_technology_capability'
import { createAddress } from '#services/address_service'
import { geocodeVendor } from '#services/geocoding_service'
import { fakeGeoClient, type GeoPlace } from '#services/google_geo_client'
import { activeVendorAttributes, listedVendorAttributes } from '#tests/helpers/vendors'

/** A few real cities - the fake geocoder only knows what it's told. */
export const CITIES = {
  austin: {
    city: 'Austin',
    state: 'TX',
    country: 'US',
    postalCode: '78701',
    lat: 30.2672,
    lng: -97.7431,
  },
  roundRock: {
    city: 'Round Rock',
    state: 'TX',
    country: 'US',
    postalCode: '78664',
    lat: 30.5083,
    lng: -97.6789,
  },
  sanAntonio: {
    city: 'San Antonio',
    state: 'TX',
    country: 'US',
    postalCode: '78205',
    lat: 29.4241,
    lng: -98.4936,
  },
  dallas: {
    city: 'Dallas',
    state: 'TX',
    country: 'US',
    postalCode: '75201',
    lat: 32.7767,
    lng: -96.797,
  },
  seattle: {
    city: 'Seattle',
    state: 'WA',
    country: 'US',
    postalCode: '98101',
    lat: 47.6062,
    lng: -122.3321,
  },
} as const

export type CityKey = keyof typeof CITIES

export function placeIdFor(key: CityKey) {
  return `place-${key}`
}

/** Registers a city with the fake Google client (place ID `place-<key>`). */
export function registerCity(key: CityKey): GeoPlace {
  const city = CITIES[key]
  return fakeGeoClient.addCity({
    placeId: placeIdFor(key),
    placeType: 'locality',
    lat: city.lat,
    lng: city.lng,
    city: city.city,
    state: city.state,
    country: city.country,
    postalCode: null,
  })
}

export interface ListedVendorOptions {
  displayName?: string
  city?: CityKey
  technologies?: VendorTechnologyCapability['technology'][]
  ratingCount?: number
  ratingAverage?: string | null
  responseRate?: number | null
  /** Skip geocoding - the vendor has no location. */
  geocode?: boolean
}

/**
 * A vendor listed in the directory: active, published, accepting inquiries,
 * with approved capabilities and a default address in `city`, geocoded
 * through the fake Google client.
 */
export async function listedVendor(options: ListedVendorOptions = {}): Promise<Vendor> {
  const cityKey = options.city ?? 'austin'
  const city = CITIES[cityKey]
  const user = await User.create({
    uuid: string.uuid(),
    email: `vendor-${string.uuid()}@test.com`,
    password: 'password123',
    role: 'vendor',
  })
  const vendor = await Vendor.create({
    uuid: string.uuid(),
    userId: user.id,
    displayName: options.displayName ?? `Shop ${string.generateRandom(6)}`,
    legalName: 'Secret Legal Name LLC',
    phone: '+15125550100',
    ratingCount: options.ratingCount ?? 0,
    ratingAverage: options.ratingAverage ?? null,
    responseRate: options.responseRate ?? null,
    ...activeVendorAttributes(),
    ...listedVendorAttributes(),
  })
  for (const technology of options.technologies ?? ['fdm']) {
    await VendorTechnologyCapability.create({
      vendorId: vendor.id,
      technology,
      status: 'approved',
      isPreferred: false,
    })
  }
  await createAddress({
    ownerType: 'vendor',
    vendorId: vendor.id,
    recipientName: 'Receiving',
    line1: '742 Evergreen Terrace',
    city: city.city,
    state: city.state,
    postalCode: city.postalCode,
    country: city.country,
    isDefault: true,
  })
  if (options.geocode !== false) {
    registerCity(cityKey)
    await geocodeVendor(vendor)
  }
  return vendor
}

/** The response's `data`. */
export function dataOf(response: any) {
  return response.body().data
}
