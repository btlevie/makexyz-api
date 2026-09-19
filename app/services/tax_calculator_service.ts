/**
 * Sales tax calculation, abstracted the same way as payment_gateway_service -
 * one interface, a real Stripe Tax-backed implementation, and an in-memory
 * Fake that test env always uses instead.
 *
 * calculate() is only ever an estimate (Stripe Tax's calculation objects are
 * quotes, not filed records). finalize() is what actually records the
 * transaction for tax remittance/filing, and must only run once payment has
 * actually captured - not at authorization, and not merely because a
 * calculation was requested.
 */
import env from '#start/env'
import { StripeTaxCalculator } from '#services/stripe_tax_calculator'

export type TaxLineItem = {
  description: string
  /** Dollars, not cents. */
  amount: number
  /** Stripe Tax product tax code - omitted for the Fake, which doesn't need it. */
  taxCode?: string
}

export type TaxCalculationParams = {
  lineItems: TaxLineItem[]
  destinationCountry: string
  /**
   * Sales tax depends on the full address, not just country (US tax varies
   * by state/county/city) - the Fake ignores this, but StripeTaxCalculator
   * needs it for an accurate jurisdiction-level rate.
   */
  destinationAddress: {
    line1: string
    line2?: string | null
    city: string
    state?: string | null
    postalCode: string
  }
}

export type TaxCalculationResult = {
  calculationId: string
  taxAmount: number
}

export interface TaxCalculator {
  calculate(params: TaxCalculationParams): Promise<TaxCalculationResult>
  finalize(calculationId: string): Promise<void>
}

export class TaxCalculatorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxCalculatorError'
  }
}

/**
 * Flat-rate stand-in (8%) - deterministic and provider-agnostic, so tests can
 * assert on tax amounts without hardcoding a real jurisdiction's rate.
 */
const FAKE_TAX_RATE = 0.08

export class FakeTaxCalculator implements TaxCalculator {
  private calculations = new Map<string, { taxAmount: number; finalized: boolean }>()
  private nextId = 1

  /** Test-only: clears all state between test groups. */
  reset(): void {
    this.calculations.clear()
    this.nextId = 1
  }

  async calculate(params: TaxCalculationParams): Promise<TaxCalculationResult> {
    const subtotal = params.lineItems.reduce((sum, line) => sum + line.amount, 0)
    const taxAmount = Math.round(subtotal * FAKE_TAX_RATE * 100) / 100
    const calculationId = `fake_tax_${this.nextId++}`
    this.calculations.set(calculationId, { taxAmount, finalized: false })
    return { calculationId, taxAmount }
  }

  async finalize(calculationId: string): Promise<void> {
    const calculation = this.calculations.get(calculationId)
    if (!calculation) {
      throw new TaxCalculatorError(`Unknown tax calculation ${calculationId}`)
    }
    calculation.finalized = true
  }

  /** Test-only: lets a test assert a calculation was (not) finalized. */
  isFinalized(calculationId: string): boolean {
    return this.calculations.get(calculationId)?.finalized ?? false
  }
}

export const fakeTaxCalculator = new FakeTaxCalculator()

export function getTaxCalculator(): TaxCalculator {
  if (env.get('NODE_ENV') === 'test') {
    return fakeTaxCalculator
  }

  return new StripeTaxCalculator()
}
