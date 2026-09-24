/**
 * Shipping option resolution. Fixed dollar amounts here are business-specified
 * constants (not placeholders), unlike production_time_service's formula
 * constants - there's no versioned config table for these because nothing
 * about them is meant to be ops-tunable without a deploy.
 */

export type ShippingMethod = 'free' | 'ups_2day' | 'ups_overnight' | 'international_expedited'

export type ShippingOption = {
  method: ShippingMethod
  /** Dollars, not cents. */
  feeAmount: number
}

export class InvalidShippingSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidShippingSelectionError'
  }
}

const DOMESTIC_OPTIONS: ShippingOption[] = [
  // Fulfilled with the cheapest USPS label once the vendor buys one (see
  // LABEL_RATE_RULES below and shipment_service.ts). This is just the
  // checkout-time price (free) and selection.
  { method: 'free', feeAmount: 0 },
  { method: 'ups_2day', feeAmount: 29 },
  { method: 'ups_overnight', feeAmount: 75 },
]

const INTERNATIONAL_OPTIONS: ShippingOption[] = [
  { method: 'free', feeAmount: 0 },
  { method: 'international_expedited', feeAmount: 49 },
]

/** The full set of options a destination country should be offered. */
export function resolveShippingOptions(destinationCountry: string): ShippingOption[] {
  return destinationCountry === 'US' ? DOMESTIC_OPTIONS : INTERNATIONAL_OPTIONS
}

/**
 * Throws InvalidShippingSelectionError for a method that isn't offered for the
 * given destination (e.g. 'ups_2day' to a non-US address) - callers decide
 * whether that fails the request.
 */
export function resolveShippingFee(destinationCountry: string, method: ShippingMethod): number {
  const match = resolveShippingOptions(destinationCountry).find(
    (option) => option.method === method
  )
  if (!match) {
    throw new InvalidShippingSelectionError(
      `"${method}" is not an available shipping method for destination "${destinationCountry}"`
    )
  }
  return match.feeAmount
}

/**
 * Which carrier rates can fulfil each checkout shipping method when a vendor
 * buys an instant-quote label. The vendor never picks the service - the
 * customer already paid for one - so the cheapest rate matching the rule is
 * bought automatically.
 *
 * Carrier/service strings are EasyPost's (Rate.carrier / Rate.service). They
 * only produce rates if the matching carrier account is enabled on MakeXYZ's
 * EasyPost account - verify these against the live account's carriers, since
 * a missing carrier surfaces as NoMatchingRateError, not a silent fallback.
 */
type LabelRateRule = {
  carrier: string
  /** null = any service from this carrier. */
  services: string[] | null
}

const LABEL_RATE_RULES: Record<ShippingMethod, LabelRateRule[]> = {
  free: [{ carrier: 'USPS', services: null }],
  ups_2day: [{ carrier: 'UPS', services: ['2ndDayAir'] }],
  ups_overnight: [{ carrier: 'UPS', services: ['NextDayAir'] }],
  international_expedited: [
    { carrier: 'UPS', services: ['Expedited', 'UPSSaver'] },
    { carrier: 'USPS', services: ['PriorityMailInternational'] },
  ],
}

export type CarrierRate = {
  id: string
  carrier: string
  service: string
  /** Decimal string, as the carrier returns it. */
  rate: string
}

/**
 * The cheapest rate satisfying `method`, or null if none do. Comparison only
 * orders the carrier's own decimal strings - no arithmetic is done on them.
 */
export function selectLabelRate<T extends CarrierRate>(
  rates: T[],
  method: ShippingMethod
): T | null {
  const rules = LABEL_RATE_RULES[method]
  const eligible = rates.filter((rate) =>
    rules.some(
      (rule) =>
        rule.carrier === rate.carrier &&
        (rule.services === null || rule.services.includes(rate.service))
    )
  )
  if (eligible.length === 0) {
    return null
  }
  return eligible.reduce((cheapest, rate) =>
    Number(rate.rate) < Number(cheapest.rate) ? rate : cheapest
  )
}
