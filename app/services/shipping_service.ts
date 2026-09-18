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
  // Fulfilled later via EasyPost/USPS once a vendor marks the order ready to
  // ship - that fulfillment step is separate future work. This is just the
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
