import { BaseTransformer } from '@adonisjs/core/transformers'
import type Vendor from '#models/vendor'
import type { DirectoryData } from '#services/vendor_profile_service'
import { responseTimeGroup } from '#services/vendor_ranking'
import { publicVendorBasics } from '#transformers/vendor_directory_card_transformer'

/**
 * A vendor's public profile page. Only public fields: never legal name,
 * phone, email, website, payout details, coordinates or the full address.
 */
export default class PublicVendorProfileTransformer extends BaseTransformer<{
  vendor: Vendor
  directory: DirectoryData
}> {
  toObject() {
    const { vendor, directory } = this.resource
    return {
      ...publicVendorBasics(vendor),
      bio: vendor.bio,
      acceptingInquiries: vendor.acceptingInquiries,
      responseTime: responseTimeGroup(vendor.responseTimeHours),
      priceTier: directory.priceTier,
      technologies: directory.technologies,
      materials: directory.materials,
      services: directory.services,
      profileImage: directory.profileImage,
      portfolio: directory.portfolio,
      memberSince: vendor.activatedAt,
    }
  }
}
