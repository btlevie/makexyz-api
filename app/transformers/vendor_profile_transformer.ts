import { BaseTransformer } from '@adonisjs/core/transformers'
import type Vendor from '#models/vendor'
import VendorImage from '#models/vendor_image'
import VendorIndicativePrice from '#models/vendor_indicative_price'
import VendorService from '#models/vendor_service'
import { imageUrls } from '#services/vendor_image_service'
import { responseTimeGroup } from '#services/vendor_ranking'

/**
 * The vendor's own view of their public profile: everything they set, its
 * moderation and listing state, and why they might not be listed.
 */
export default class VendorProfileTransformer extends BaseTransformer<Vendor> {
  async toObject() {
    const vendor = this.resource
    const [services, prices, images] = await Promise.all([
      VendorService.query().where('vendorId', vendor.id).orderBy('service', 'asc'),
      VendorIndicativePrice.query().where('vendorId', vendor.id).preload('material'),
      VendorImage.query()
        .where('vendorId', vendor.id)
        .whereNot('status', 'rejected')
        .orderBy('kind', 'asc')
        .orderBy('position', 'asc'),
    ])

    const notListedBecause: string[] = []
    if (vendor.status !== 'active') notListedBecause.push('vendor_not_active')
    if (!vendor.acceptingInquiries) notListedBecause.push('not_accepting_inquiries')
    if (!vendor.profilePublishedAt || !vendor.profileSlug) notListedBecause.push('not_published')
    if (vendor.profileModerationStatus === 'pending_review') notListedBecause.push('text_in_review')
    if (vendor.profileModerationStatus === 'rejected') notListedBecause.push('text_rejected')

    return {
      uuid: vendor.uuid,
      displayName: vendor.displayName,
      profileSlug: vendor.profileSlug,
      bio: vendor.bio,
      acceptingInquiries: vendor.acceptingInquiries,
      publishedAt: vendor.profilePublishedAt,
      moderationStatus: vendor.profileModerationStatus,
      listed: vendor.isListed,
      notListedBecause,
      location: {
        city: vendor.locationCity,
        state: vendor.locationState,
        country: vendor.locationCountry,
        geocodeStatus: vendor.geocodeStatus,
      },
      rating: {
        average: vendor.ratingAverage === null ? null : Number(vendor.ratingAverage),
        count: vendor.ratingCount,
      },
      responseRate: vendor.responseRate,
      responseTime: responseTimeGroup(vendor.responseTimeHours),
      services: services.map((service) => ({
        service: service.service,
        active: service.active,
        disabledByAdmin: service.adminDisabledAt !== null,
        rate: service.rate,
        rateUnit: service.rateUnit,
        description: service.description,
      })),
      indicativePrices: prices.map((price) => ({
        materialUuid: price.material.uuid,
        materialName: price.material.name,
        pricePerCm3: price.pricePerCubicCm,
      })),
      images: await Promise.all(
        images.map(async (image) => {
          const urls = await imageUrls(image)
          return {
            uuid: image.uuid,
            kind: image.kind,
            status: image.status,
            rejectReason: image.rejectReason,
            position: image.position,
            url: urls?.url ?? null,
            thumbnailUrl: urls?.thumbnailUrl ?? null,
          }
        })
      ),
    }
  }
}
