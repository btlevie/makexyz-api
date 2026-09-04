import { test } from '@japa/runner'
import {
  calculateBulkFloorMultiplier,
  calculateFdmPrice,
  calculateQuantityDecayFactor,
  InvalidPricingConfigError,
  InvalidPricingInputError,
  roundCurrency,
  type FdmPricingInputs,
  type ResolvedFdmPricingConfig,
} from '#services/fdm_pricing_calculator'

/** The current default constants, per the pricing specification. */
const CONFIG: ResolvedFdmPricingConfig = {
  id: 1,
  version: 1,
  modelMaterialRatePerGram: 0.15,
  supportMaterialRatePerGram: 0.3,
  machineRatePerHour: 2.0,
  failureBufferMultiplier: 1.1,
  fixedLineItemCharge: 7.5,
  bulkFloorSmallMultiplier: 10.0,
  bulkFloorLargeMultiplier: 3.25,
  bulkFloorBreakGrams: 75.0,
  bulkFloorSigmoidWidthGrams: 15.0,
  quantityDecayConstant: 18.0,
  oversizeThresholdMm: 325.0,
  oversizeMultiplier: 1.3,
}

/** The specification's worked example: 50g model, 10g support, 2h, normal size. */
const INPUTS: FdmPricingInputs = {
  quantity: 1,
  modelGrams: 50,
  supportGrams: 10,
  printHours: 2,
  trueFilamentCostPerGram: 0.02,
  xMm: 100,
  yMm: 100,
  zMm: 100,
}

function withInputs(overrides: Partial<FdmPricingInputs>): FdmPricingInputs {
  return { ...INPUTS, ...overrides }
}

function withConfig(overrides: Partial<ResolvedFdmPricingConfig>): ResolvedFdmPricingConfig {
  return { ...CONFIG, ...overrides }
}

test.group('FDM pricing | single part', () => {
  test('prices the specification worked example at $23.45', ({ assert }) => {
    const { calculation } = calculateFdmPrice(INPUTS, CONFIG)

    assert.closeTo(calculation.modelCharge, 7.5, 1e-9)
    assert.closeTo(calculation.supportCharge, 3.0, 1e-9)
    assert.closeTo(calculation.machineCharge, 4.0, 1e-9)
    assert.closeTo(calculation.preBufferVariablePrice, 14.5, 1e-9)
    assert.closeTo(calculation.variablePrice, 15.95, 1e-9)
    assert.closeTo(calculation.linePriceBeforeOversize, 23.45, 1e-9)
    assert.isFalse(calculation.isOversize)
    assert.equal(calculation.finalPriceRounded, 23.45)
  })

  test('applies no minimum price - a small part may price below $30', ({ assert }) => {
    const { calculation } = calculateFdmPrice(
      withInputs({ modelGrams: 2, supportGrams: 0, printHours: 0.1 }),
      CONFIG
    )

    assert.isBelow(calculation.finalPriceRounded, 30)
    assert.closeTo(calculation.finalPriceRounded, roundCurrency(1.1 * (2 * 0.15 + 0.2) + 7.5), 1e-9)
  })

  test('leaves bulk-only fields null rather than fabricating them', ({ assert }) => {
    const { calculation } = calculateFdmPrice(INPUTS, CONFIG)

    assert.isNull(calculation.trueModelMaterialCost)
    assert.isNull(calculation.bulkFloorMultiplier)
    assert.isNull(calculation.bulkFloorPrice)
    assert.isNull(calculation.quantityDecayFactor)
    assert.isNull(calculation.bulkUnitPrice)
    assert.isNull(calculation.bulkFloorExceedsVariablePrice)
  })

  test('charges the fixed line-item charge exactly once', ({ assert }) => {
    const { calculation } = calculateFdmPrice(INPUTS, CONFIG)

    assert.closeTo(calculation.linePriceBeforeOversize - calculation.partsPrice, 7.5, 1e-9)
  })

  test('zero support removes the support charge only', ({ assert }) => {
    const { calculation } = calculateFdmPrice(withInputs({ supportGrams: 0 }), CONFIG)

    assert.equal(calculation.supportCharge, 0)
    assert.closeTo(calculation.finalPriceRounded, roundCurrency(1.1 * 11.5 + 7.5), 1e-9)
  })

  test('large support dominates the variable price', ({ assert }) => {
    const { calculation } = calculateFdmPrice(withInputs({ supportGrams: 500 }), CONFIG)

    assert.closeTo(calculation.supportCharge, 150, 1e-9)
    assert.isAbove(calculation.supportCharge, calculation.modelCharge)
  })

  test('scales with print time', ({ assert }) => {
    const short = calculateFdmPrice(withInputs({ printHours: 0.05 }), CONFIG)
    const long = calculateFdmPrice(withInputs({ printHours: 96 }), CONFIG)

    assert.closeTo(short.calculation.machineCharge, 0.1, 1e-9)
    assert.closeTo(long.calculation.machineCharge, 192, 1e-9)
    assert.isAbove(long.calculation.finalPrice, short.calculation.finalPrice)
  })
})

test.group('FDM pricing | oversize', () => {
  test('a part measuring exactly the threshold is not oversize', ({ assert }) => {
    const { calculation } = calculateFdmPrice(withInputs({ xMm: 325 }), CONFIG)

    assert.isFalse(calculation.isOversize)
    assert.equal(calculation.finalPriceRounded, 23.45)
  })

  test('a part just above the threshold is oversize and prices at $30.49', ({ assert }) => {
    const { calculation } = calculateFdmPrice(withInputs({ xMm: 325.01 }), CONFIG)

    assert.isTrue(calculation.isOversize)
    assert.equal(calculation.maxDimensionMm, 325.01)
    assert.equal(calculation.finalPriceRounded, 30.49)
  })

  test('a part just below the threshold is not oversize', ({ assert }) => {
    const { calculation } = calculateFdmPrice(withInputs({ xMm: 324.99 }), CONFIG)

    assert.isFalse(calculation.isOversize)
  })

  test('oversize triggers on whichever axis is largest', ({ assert }) => {
    for (const axis of ['xMm', 'yMm', 'zMm'] as const) {
      const { calculation } = calculateFdmPrice(withInputs({ [axis]: 400 }), CONFIG)

      assert.isTrue(calculation.isOversize, `${axis} over threshold should be oversize`)
      assert.equal(calculation.maxDimensionMm, 400)
    }
  })

  test('all dimensions below the threshold is not oversize', ({ assert }) => {
    const { calculation } = calculateFdmPrice(
      withInputs({ xMm: 324, yMm: 100, zMm: 12 }),
      CONFIG
    )

    assert.isFalse(calculation.isOversize)
    assert.equal(calculation.maxDimensionMm, 324)
  })

  test('the oversize multiplier applies to the fixed charge too', ({ assert }) => {
    const normal = calculateFdmPrice(INPUTS, CONFIG)
    const oversize = calculateFdmPrice(withInputs({ xMm: 400 }), CONFIG)

    assert.closeTo(
      oversize.calculation.finalPrice,
      normal.calculation.linePriceBeforeOversize * 1.3,
      1e-9
    )
  })
})

test.group('FDM pricing | sigmoid bulk floor', () => {
  test('sits exactly halfway between the endpoints at the break weight', ({ assert }) => {
    // 3.25 + (10 - 3.25) / 2 = 6.625
    assert.closeTo(calculateBulkFloorMultiplier(75, CONFIG), 6.625, 1e-12)
  })

  test('approaches the small-part multiplier for very light models', ({ assert }) => {
    // With the default 15g width, a near-zero part is only ~5 widths below the
    // 75g break, so it lands just under the 10x endpoint rather than on it.
    assert.closeTo(calculateBulkFloorMultiplier(0.001, CONFIG), 10, 0.05)

    // Narrowing the transition pushes the same weight far enough down the curve
    // to reach the endpoint, confirming 10x really is the limit.
    const narrow = withConfig({ bulkFloorSigmoidWidthGrams: 1 })
    assert.closeTo(calculateBulkFloorMultiplier(0.001, narrow), 10, 1e-9)
  })

  test('approaches the large-part multiplier for very heavy models', ({ assert }) => {
    assert.closeTo(calculateBulkFloorMultiplier(5000, CONFIG), 3.25, 1e-9)
  })

  test('decreases monotonically as model weight grows', ({ assert }) => {
    const weights = [1, 25, 50, 75, 100, 150, 400]
    const multipliers = weights.map((grams) => calculateBulkFloorMultiplier(grams, CONFIG))

    for (let i = 1; i < multipliers.length; i++) {
      assert.isBelow(multipliers[i], multipliers[i - 1])
    }
  })

  test('derives its range from both endpoints rather than a hard-coded constant', ({
    assert,
  }) => {
    // Moving only the small-part endpoint must move the midpoint with it.
    const widened = withConfig({ bulkFloorSmallMultiplier: 20 })

    assert.closeTo(calculateBulkFloorMultiplier(75, widened), 3.25 + (20 - 3.25) / 2, 1e-12)
  })
})

test.group('FDM pricing | quantity decay', () => {
  test('is exactly 1 at quantity 1', ({ assert }) => {
    assert.equal(calculateQuantityDecayFactor(1, CONFIG), 1)
  })

  test('approaches zero as quantity grows', ({ assert }) => {
    assert.closeTo(calculateQuantityDecayFactor(100000, CONFIG), 0, 1e-9)
  })

  test('the bulk formula at quantity 1 reduces to the variable price', ({ assert }) => {
    // Consistency check only - the engine still routes Q=1 through the single branch.
    const { calculation } = calculateFdmPrice(INPUTS, CONFIG)
    const totalGrams = INPUTS.modelGrams + INPUTS.supportGrams
    const floorMultiplier = calculateBulkFloorMultiplier(totalGrams, CONFIG)
    const floor = totalGrams * INPUTS.trueFilamentCostPerGram * floorMultiplier
    const decay = calculateQuantityDecayFactor(1, CONFIG)

    assert.closeTo(floor + (calculation.variablePrice - floor) * decay, calculation.variablePrice, 1e-9)
  })
})

test.group('FDM pricing | bulk', () => {
  test('matches an independently computed quantity-10 line price', ({ assert }) => {
    const { calculation } = calculateFdmPrice(withInputs({ quantity: 10 }), CONFIG)

    const pVar = 1.1 * (50 * 0.15 + 10 * 0.3 + 2 * 2.0)
    // The floor is built from total extruded filament - model + support - and
    // that same total drives the sigmoid.
    const totalGrams = 50 + 10
    const cMat = totalGrams * 0.02
    const floorMultiplier = 3.25 + (10 - 3.25) / (1 + Math.exp((totalGrams - 75) / 15))
    const pFloor = cMat * floorMultiplier
    const decay = Math.exp(-(10 - 1) / 18)
    const pUnit = pFloor + (pVar - pFloor) * decay
    const expectedLine = 10 * pUnit + 7.5

    assert.closeTo(calculation.variablePrice, pVar, 1e-9)
    assert.closeTo(calculation.trueModelMaterialCost!, cMat, 1e-9)
    assert.closeTo(calculation.bulkFloorMultiplier!, floorMultiplier, 1e-9)
    assert.closeTo(calculation.bulkFloorPrice!, pFloor, 1e-9)
    assert.closeTo(calculation.quantityDecayFactor!, decay, 1e-9)
    assert.closeTo(calculation.bulkUnitPrice!, pUnit, 1e-9)
    assert.closeTo(calculation.finalPrice, expectedLine, 1e-9)
  })

  test('adds the fixed charge once, not per unit, at quantity 100', ({ assert }) => {
    const { calculation } = calculateFdmPrice(withInputs({ quantity: 100 }), CONFIG)

    assert.closeTo(calculation.linePriceBeforeOversize - calculation.partsPrice, 7.5, 1e-9)
    assert.closeTo(calculation.partsPrice, 100 * calculation.bulkUnitPrice!, 1e-9)
  })

  test('unit price declines with quantity and stays above the floor', ({ assert }) => {
    const quantities = [2, 5, 10, 50, 100, 1000]
    const unitPrices = quantities.map(
      (quantity) => calculateFdmPrice(withInputs({ quantity }), CONFIG).calculation.bulkUnitPrice!
    )

    for (let i = 1; i < unitPrices.length; i++) {
      assert.isBelow(unitPrices[i], unitPrices[i - 1])
    }

    const floor = calculateFdmPrice(withInputs({ quantity: 2 }), CONFIG).calculation.bulkFloorPrice!
    for (const unitPrice of unitPrices) {
      assert.isAtLeast(unitPrice, floor)
    }
  })

  test('converges to the floor at very high quantity', ({ assert }) => {
    const { calculation } = calculateFdmPrice(withInputs({ quantity: 100000 }), CONFIG)

    assert.closeTo(calculation.bulkUnitPrice!, calculation.bulkFloorPrice!, 1e-6)
  })

  test('quantity 2 sits just below the single-part variable price', ({ assert }) => {
    const single = calculateFdmPrice(INPUTS, CONFIG)
    const bulk = calculateFdmPrice(withInputs({ quantity: 2 }), CONFIG)

    assert.isBelow(bulk.calculation.bulkUnitPrice!, single.calculation.variablePrice)
  })

  test('a floor above the variable price is preserved and flagged, not clamped', ({
    assert,
  }) => {
    // An expensive material pushes the floor above normal retail. The specified
    // formula then moves unit price UP toward the floor as quantity grows.
    const expensive = withInputs({ quantity: 50, trueFilamentCostPerGram: 5 })
    const { calculation } = calculateFdmPrice(expensive, CONFIG)

    assert.isTrue(calculation.bulkFloorExceedsVariablePrice)
    assert.isAbove(calculation.bulkFloorPrice!, calculation.variablePrice)
    assert.isAbove(calculation.bulkUnitPrice!, calculation.variablePrice)
    assert.isBelow(calculation.bulkUnitPrice!, calculation.bulkFloorPrice!)
  })

  test('bulk oversize multiplies the whole line including the fixed charge', ({ assert }) => {
    const normal = calculateFdmPrice(withInputs({ quantity: 10 }), CONFIG)
    const oversize = calculateFdmPrice(withInputs({ quantity: 10, zMm: 500 }), CONFIG)

    assert.isTrue(oversize.calculation.isOversize)
    assert.closeTo(
      oversize.calculation.finalPrice,
      normal.calculation.linePriceBeforeOversize * 1.3,
      1e-9
    )
  })
})

test.group('FDM pricing | configuration sensitivity', () => {
  test('a changed model rate changes the price', ({ assert }) => {
    const before = calculateFdmPrice(INPUTS, CONFIG)
    const after = calculateFdmPrice(INPUTS, withConfig({ modelMaterialRatePerGram: 0.17 }))

    assert.notEqual(after.calculation.finalPrice, before.calculation.finalPrice)
    assert.closeTo(after.calculation.modelCharge, 8.5, 1e-9)
  })

  test('records which configuration produced the result', ({ assert }) => {
    const result = calculateFdmPrice(INPUTS, withConfig({ id: 17, version: 4 }))

    assert.deepEqual(result.pricingConfiguration, { id: 17, version: 4 })
  })

  test('is deterministic for identical inputs and configuration', ({ assert }) => {
    const a = calculateFdmPrice(withInputs({ quantity: 37 }), CONFIG)
    const b = calculateFdmPrice(withInputs({ quantity: 37 }), CONFIG)

    assert.deepEqual(a, b)
  })
})

test.group('FDM pricing | input validation', () => {
  const invalidInputCases: [string, Partial<FdmPricingInputs>][] = [
    ['quantity below 1', { quantity: 0 }],
    ['negative quantity', { quantity: -5 }],
    ['fractional quantity', { quantity: 2.5 }],
    ['negative model grams', { modelGrams: -1 }],
    ['negative support grams', { supportGrams: -0.5 }],
    ['negative print hours', { printHours: -2 }],
    ['negative filament cost', { trueFilamentCostPerGram: -0.02 }],
    ['zero dimension', { yMm: 0 }],
    ['negative dimension', { zMm: -10 }],
    ['non-finite model grams', { modelGrams: Number.NaN }],
    ['infinite print hours', { printHours: Number.POSITIVE_INFINITY }],
  ]

  for (const [description, overrides] of invalidInputCases) {
    test(`rejects ${description}`, ({ assert }) => {
      assert.throws(
        () => calculateFdmPrice(withInputs(overrides), CONFIG),
        InvalidPricingInputError
      )
    })
  }

  test('accepts zero grams and zero print time', ({ assert }) => {
    const { calculation } = calculateFdmPrice(
      withInputs({ modelGrams: 0, supportGrams: 0, printHours: 0 }),
      CONFIG
    )

    assert.equal(calculation.finalPriceRounded, 7.5)
  })

  test('reports every problem at once', ({ assert }) => {
    try {
      calculateFdmPrice(withInputs({ quantity: 0, modelGrams: -1, zMm: 0 }), CONFIG)
      assert.fail('expected InvalidPricingInputError')
    } catch (error) {
      assert.instanceOf(error, InvalidPricingInputError)
      const message = (error as Error).message
      assert.include(message, 'quantity')
      assert.include(message, 'modelGrams')
      assert.include(message, 'zMm')
    }
  })
})

test.group('FDM pricing | configuration validation', () => {
  const invalidConfigCases: [string, Partial<ResolvedFdmPricingConfig>][] = [
    ['zero sigmoid width', { bulkFloorSigmoidWidthGrams: 0 }],
    ['negative sigmoid width', { bulkFloorSigmoidWidthGrams: -15 }],
    ['zero decay constant', { quantityDecayConstant: 0 }],
    ['negative decay constant', { quantityDecayConstant: -18 }],
    ['zero failure buffer', { failureBufferMultiplier: 0 }],
    ['zero oversize threshold', { oversizeThresholdMm: 0 }],
    ['zero oversize multiplier', { oversizeMultiplier: 0 }],
    ['zero small floor multiplier', { bulkFloorSmallMultiplier: 0 }],
    ['zero large floor multiplier', { bulkFloorLargeMultiplier: 0 }],
    ['negative model rate', { modelMaterialRatePerGram: -0.15 }],
    ['negative fixed charge', { fixedLineItemCharge: -7.5 }],
    ['non-finite machine rate', { machineRatePerHour: Number.NaN }],
  ]

  for (const [description, overrides] of invalidConfigCases) {
    test(`rejects ${description}`, ({ assert }) => {
      assert.throws(
        () => calculateFdmPrice(INPUTS, withConfig(overrides)),
        InvalidPricingConfigError
      )
    })
  }
})

test.group('FDM pricing | rounding', () => {
  test('rounds the oversize example half-up to $30.49', ({ assert }) => {
    assert.equal(roundCurrency(23.45 * 1.3), 30.49)
  })

  test('rounds to two decimal places', ({ assert }) => {
    assert.equal(roundCurrency(1.005), 1.01)
    assert.equal(roundCurrency(2.344), 2.34)
    assert.equal(roundCurrency(2.345), 2.35)
    assert.equal(roundCurrency(0), 0)
  })

  test('preserves the unrounded price alongside the rounded one', ({ assert }) => {
    const { calculation } = calculateFdmPrice(withInputs({ xMm: 400 }), CONFIG)

    assert.notEqual(calculation.finalPrice, calculation.finalPriceRounded)
    assert.equal(roundCurrency(calculation.finalPrice), calculation.finalPriceRounded)
  })
})
