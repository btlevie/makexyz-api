import type { HttpContext } from '@adonisjs/core/http'
import {
  listIndexable,
  LocationNotFoundError,
  showLocation,
} from '#services/service_location_service'
import ServiceLocationTransformer, {
  publicLocation,
} from '#transformers/service_location_transformer'

/**
 * Public city pages (docs/plans/manual_quotes.md, 2c). Only indexable pages
 * are listed (the sitemap and city index); any page can be shown, with the
 * nearest indexable one as its canonical target when it isn't indexable.
 */
export default class LocationsController {
  async index({ serialize }: HttpContext) {
    return await serialize(ServiceLocationTransformer.transform(await listIndexable()))
  }

  async show({ params, response, serialize }: HttpContext) {
    try {
      const { location, nearestIndexable } = await showLocation(String(params.slug).toLowerCase())
      return await serialize({
        location: publicLocation(location),
        nearestIndexable: nearestIndexable ? publicLocation(nearestIndexable) : null,
      })
    } catch (error) {
      if (error instanceof LocationNotFoundError) {
        return response.notFound({ error: 'Location not found' })
      }
      throw error
    }
  }
}
