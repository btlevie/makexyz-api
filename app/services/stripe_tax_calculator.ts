/**
 * Real Stripe Tax-backed TaxCalculator. Never exercised by tests (test env
 * always uses FakeTaxCalculator, see tax_calculator_service.ts) - needs a real
 * STRIPE_SECRET_KEY, which doesn't exist yet.
 */
import Stripe from 'stripe'
import env from '#start/env'
import { TaxCalculatorError } from '#services/tax_calculator_service'
import type {
  TaxCalculationParams,
  TaxCalculationResult,
  TaxCalculator,
} from '#services/tax_calculator_service'

export class StripeTaxCalculator implements TaxCalculator {
  private client: Stripe

  constructor() {
    const secretKey = env.get('STRIPE_SECRET_KEY')
    if (!secretKey) {
      throw new TaxCalculatorError('STRIPE_SECRET_KEY is not configured')
    }
    this.client = new Stripe(secretKey)
  }

  async calculate(params: TaxCalculationParams): Promise<TaxCalculationResult> {
    const calculation = await this.client.tax.calculations.create({
      currency: 'usd',
      line_items: params.lineItems.map((line) => ({
        amount: Math.round(line.amount * 100),
        reference: line.description,
        tax_code: line.taxCode,
      })),
      customer_details: {
        address: { country: params.destinationCountry },
        address_source: 'shipping',
      },
    })

    return {
      calculationId: calculation.id!,
      taxAmount: calculation.tax_amount_exclusive / 100,
    }
  }

  async finalize(calculationId: string): Promise<void> {
    await this.client.tax.transactions.createFromCalculation({
      calculation: calculationId,
      reference: calculationId,
    })
  }
}
