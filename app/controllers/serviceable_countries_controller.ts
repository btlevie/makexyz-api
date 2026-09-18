import type { HttpContext } from '@adonisjs/core/http'
import ServiceableCountryTransformer from '#transformers/serviceable_country_transformer'
import { listServiceableCountries } from '#services/serviceable_country_service'

export default class ServiceableCountriesController {
  /**
   * Feeds the checkout/quote-configuration address form's country dropdown -
   * public, no auth needed, matches the rest of the anonymous instant-quote
   * flow's read endpoints.
   */
  async index({ serialize }: HttpContext) {
    const countries = await listServiceableCountries()
    return await serialize(ServiceableCountryTransformer.transform(countries))
  }
}
