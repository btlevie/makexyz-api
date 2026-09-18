/**
 * Countries where Stripe Tax can calculate tax on a PHYSICAL good (Stripe's
 * "All PTCs" support level - https://docs.stripe.com/tax/supported-countries,
 * fetched 2026-09-03). Deliberately narrower than Stripe Tax's full supported-
 * countries list: most of that list is "Digital products" support only (VAT on
 * digital goods), which cannot calculate tax on the manufactured parts this
 * business actually ships - only "All PTCs" countries can.
 *
 * Hand-maintained, not queried live - Stripe has no API for this, only
 * documentation that changes as they add countries. Re-verify against the URL
 * above before adding an entry; getting this wrong means either rejecting a
 * country Stripe actually supports, or silently mis-taxing an order.
 *
 * serviceable_countries (the narrower, business-controlled list actually
 * offered to customers) must always be a subset of this constant - see
 * database/seeders/serviceable_country_seeder.ts.
 */
export const STRIPE_TAX_SUPPORTED_COUNTRIES = {
  US: 'United States',
  AU: 'Australia',
  AT: 'Austria',
  BE: 'Belgium',
  BG: 'Bulgaria',
  CA: 'Canada',
  HR: 'Croatia',
  CY: 'Cyprus',
  CZ: 'Czechia',
  DK: 'Denmark',
  EE: 'Estonia',
  FI: 'Finland',
  FR: 'France',
  DE: 'Germany',
  GR: 'Greece',
  HK: 'Hong Kong',
  HU: 'Hungary',
  IE: 'Ireland',
  IT: 'Italy',
  JP: 'Japan',
  LV: 'Latvia',
  LI: 'Liechtenstein',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  MT: 'Malta',
  MX: 'Mexico',
  NL: 'Netherlands',
  NZ: 'New Zealand',
  NO: 'Norway',
  PL: 'Poland',
  PT: 'Portugal',
  PR: 'Puerto Rico',
  RO: 'Romania',
  SG: 'Singapore',
  SK: 'Slovakia',
  SI: 'Slovenia',
  ES: 'Spain',
  SE: 'Sweden',
  CH: 'Switzerland',
  AE: 'United Arab Emirates',
  GB: 'United Kingdom',
} as const

export type StripeTaxSupportedCountryCode = keyof typeof STRIPE_TAX_SUPPORTED_COUNTRIES

export function isStripeTaxSupportedCountry(
  code: string
): code is StripeTaxSupportedCountryCode {
  return code in STRIPE_TAX_SUPPORTED_COUNTRIES
}
