import ServiceableCountry from '#models/serviceable_country'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import {
  STRIPE_TAX_SUPPORTED_COUNTRIES,
  isStripeTaxSupportedCountry,
} from '#constants/stripe_tax_supported_countries'

/**
 * The business-controlled list of countries actually offered at checkout -
 * deliberately just 'US' for now. Which other Stripe-Tax-supported countries
 * to actually serve is a business decision that hasn't been made yet (see the
 * plan's "Open items requiring sign-off") - seeding a full list here would be
 * inventing that decision, not implementing it.
 */
const SERVICEABLE_COUNTRY_CODES = ['US'] as const

export default class extends BaseSeeder {
  async run() {
    for (const code of SERVICEABLE_COUNTRY_CODES) {
      // Mechanical enforcement, not just a comment: a serviceable country that
      // Stripe Tax can't calculate for physical goods would let a customer
      // through checkout with silently wrong (absent) tax.
      if (!isStripeTaxSupportedCountry(code)) {
        throw new Error(
          `Serviceable country ${code} is not in STRIPE_TAX_SUPPORTED_COUNTRIES - Stripe Tax cannot calculate tax on physical goods there.`
        )
      }

      const countryName = STRIPE_TAX_SUPPORTED_COUNTRIES[code]
      const existing = await ServiceableCountry.find(code)
      if (existing) {
        existing.merge({ countryName, isActive: true })
        await existing.save()
      } else {
        await ServiceableCountry.create({
          countryCode: code,
          countryName,
          isActive: true,
        })
      }
    }
  }
}
