import type { HttpContext } from '@adonisjs/core/http'
import Customer from '#models/customer'
import { loadDirectoryData, findListedBySlug } from '#services/vendor_profile_service'
import {
  searchVendors,
  UnknownMaterialError,
  type SearchInput,
} from '#services/vendor_search_service'
import { LocationNotFoundError } from '#services/service_location_service'
import PublicVendorProfileTransformer from '#transformers/public_vendor_profile_transformer'
import { publicLocation } from '#transformers/service_location_transformer'
import VendorDirectoryCardTransformer from '#transformers/vendor_directory_card_transformer'
import { vendorSearchValidator } from '#validators/vendor_directory'

/**
 * The public vendor directory (docs/plans/manual_quotes.md, section 2):
 * search and profiles. Public, so nothing here exposes a vendor's
 * coordinates, street address, legal name or contact details.
 */
export default class VendorsController {
  /**
   * POST /v1/vendors/search - a POST so the searcher's location stays out of
   * URLs, access logs and caches.
   */
  async search(ctx: HttpContext) {
    const { auth, request, response, serialize } = ctx
    const input = (await request.validateUsing(vendorSearchValidator)) as SearchInput

    const user = auth.user
    const customer =
      user && user.role === 'customer' ? await Customer.findBy('userId', user.id) : null

    let result
    try {
      result = await searchVendors(input, { customerId: customer?.id ?? null })
    } catch (error) {
      if (error instanceof LocationNotFoundError) {
        return response.notFound({ error: 'Location not found' })
      }
      if (error instanceof UnknownMaterialError) {
        return response.unprocessableEntity({ error: 'Unknown material' })
      }
      throw error
    }

    const { location } = result
    return await serialize({
      vendors: VendorDirectoryCardTransformer.transform(result.cards),
      location: {
        city: location.place.city,
        state: location.place.state,
        country: location.place.country,
        postalCode: location.place.postalCode,
        ranked: location.center !== null,
        matched: location.matched ? publicLocation(location.matched) : null,
        canonical: location.canonical ? publicLocation(location.canonical) : null,
      },
      meta: { total: result.total, page: result.page, perPage: result.perPage },
    })
  }

  /** GET /v1/vendors/:slug - a listed vendor's public profile. */
  async show({ params, response, serialize }: HttpContext) {
    const vendor = await findListedBySlug(String(params.slug).toLowerCase())
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }
    const loaded = await loadDirectoryData([vendor.id], { withPortfolio: true })
    const directory = loaded.get(vendor.id)!
    return await serialize(PublicVendorProfileTransformer.transform({ vendor, directory }))
  }
}
