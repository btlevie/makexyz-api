import { BaseTransformer } from '@adonisjs/core/transformers'
import type Vendor from '#models/vendor'
import type { DirectoryCard } from '#services/vendor_search_service'

/**
 * The public basics shared by search cards and profiles: the vendor's city
 * (never the street address or coordinates) and its reputation. Legal name,
 * phone, email and payout details are never exposed.
 */
export function publicVendorBasics(vendor: Vendor) {
  return {
    uuid: vendor.uuid,
    slug: vendor.profileSlug,
    displayName: vendor.displayName,
    location: {
      city: vendor.locationCity,
      state: vendor.locationState,
      country: vendor.locationCountry,
    },
    rating: {
      average: vendor.ratingAverage === null ? null : Number(vendor.ratingAverage),
      count: vendor.ratingCount,
    },
    responseRate: vendor.responseRate,
  }
}

/** One vendor in directory search results. */
export default class VendorDirectoryCardTransformer extends BaseTransformer<DirectoryCard> {
  toObject() {
    const card = this.resource
    return {
      ...publicVendorBasics(card.vendor),
      distance:
        card.distanceMiles === null ? null : { miles: card.distanceMiles, km: card.distanceKm },
      responseTime: card.responseTime,
      priceTier: card.priceTier,
      technologies: card.technologies,
      services: [
        ...(card.technologies.length > 0 ? ['printing'] : []),
        ...card.services.map((service) => service.service),
      ],
      profileImage: card.profileImage,
      featuredNewcomer: card.featuredNewcomer,
    }
  }
}
