import { test } from '@japa/runner'
import { FakeTaxCalculator, TaxCalculatorError } from '#services/tax_calculator_service'

const destinationAddress = {
  line1: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62704',
}

test.group('FakeTaxCalculator', (group) => {
  let calculator: FakeTaxCalculator

  group.each.setup(() => {
    calculator = new FakeTaxCalculator()
  })

  test('calculates a flat rate over the sum of line items', async ({ assert }) => {
    const result = await calculator.calculate({
      lineItems: [
        { description: 'Manufacturing', amount: 100 },
        { description: 'Shipping', amount: 20 },
      ],
      destinationCountry: 'US',
      destinationAddress,
    })

    assert.equal(result.taxAmount, Math.round(120 * 0.08 * 100) / 100)
  })

  test('a calculation is not finalized until finalize is called', async ({ assert }) => {
    const { calculationId } = await calculator.calculate({
      lineItems: [{ description: 'Manufacturing', amount: 100 }],
      destinationCountry: 'US',
      destinationAddress,
    })

    assert.isFalse(calculator.isFinalized(calculationId))

    await calculator.finalize(calculationId)

    assert.isTrue(calculator.isFinalized(calculationId))
  })

  test('finalizing an unknown calculation fails', async ({ assert }) => {
    await assert.rejects(() => calculator.finalize('does-not-exist'), TaxCalculatorError)
  })

  test('reset clears all state', async ({ assert }) => {
    const { calculationId } = await calculator.calculate({
      lineItems: [{ description: 'Manufacturing', amount: 100 }],
      destinationCountry: 'US',
      destinationAddress,
    })

    calculator.reset()

    await assert.rejects(() => calculator.finalize(calculationId), TaxCalculatorError)
  })
})
