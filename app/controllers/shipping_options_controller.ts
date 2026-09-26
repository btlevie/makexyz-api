import type { HttpContext } from '@adonisjs/core/http'
import ShippingOptionTransformer from '#transformers/shipping_option_transformer'
import { listShippingOptionsValidator } from '#validators/shipping_option'
import { resolveShippingOptions } from '#services/shipping_service'
import { isServiceableCountry } from '#services/serviceable_country_service'

export default class ShippingOptionsController {
  /**
   * Feeds the quote-configuration shipping-method picker - the methods
   * offered to a destination country and their fees, straight from
   * resolveShippingOptions (the same source configure prices from). Public,
   * no auth needed: nothing here is project-specific.
   */
  async index({ request, response, serialize }: HttpContext) {
    const { country } = await request.validateUsing(listShippingOptionsValidator)

    // Same refusal as configure, so the frontend never offers shipping to a
    // destination checkout would reject.
    if (!(await isServiceableCountry(country))) {
      return response.unprocessableEntity({
        error: `We don't currently ship to "${country}"`,
      })
    }

    return await serialize(ShippingOptionTransformer.transform(resolveShippingOptions(country)))
  }
}
