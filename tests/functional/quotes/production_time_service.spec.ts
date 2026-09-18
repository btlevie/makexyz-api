import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import ProductionTimeConfig from '#models/production_time_config'
import { roundCurrency } from '#services/fdm_pricing_calculator'
import {
  computeProductionTimeFee,
  getActiveProductionTimeConfig,
  isProductionTimeFeasible,
  InvalidProductionTimeSelectionError,
  ProductionTimeConfigurationError,
} from '#services/production_time_service'

async function createConfig(
  options: {
    version?: number
    isActive?: boolean
    standardBusinessDays?: number
    baseFee?: string
    growthRate?: string
    tiers?: number[] | null
  } = {}
) {
  const config = await ProductionTimeConfig.create({
    name: `Production time v${options.version ?? 1}`,
    version: options.version ?? 1,
    isActive: options.isActive ?? true,
    standardBusinessDays: options.standardBusinessDays ?? 5,
    baseFee: options.baseFee ?? '5.00',
    growthRate: options.growthRate ?? '1.6',
  })

  const tiers = options.tiers === undefined ? [5, 3, 2, 1] : options.tiers
  if (tiers) {
    await config.related('tiers').createMany(tiers.map((businessDays) => ({ businessDays })))
  }

  return config
}

async function expectConfigurationError(assert: any, message: string) {
  try {
    await getActiveProductionTimeConfig()
    assert.fail('expected ProductionTimeConfigurationError')
  } catch (error) {
    assert.instanceOf(error, ProductionTimeConfigurationError)
    assert.include((error as Error).message.toLowerCase(), message.toLowerCase())
  }
}

test.group('Production time configuration | loading', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('resolves numbers and every configured tier', async ({ assert }) => {
    const created = await createConfig()

    const config = await getActiveProductionTimeConfig()

    assert.equal(config.id, created.id)
    assert.equal(config.standardBusinessDays, 5)
    assert.equal(config.baseFee, 5)
    assert.equal(config.growthRate, 1.6)
    assert.sameMembers(config.tierBusinessDays, [5, 3, 2, 1])
  })

  test('fails when no configuration is active', async ({ assert }) => {
    await createConfig({ isActive: false })

    await expectConfigurationError(assert, 'no active production-time configuration')
  })

  test('fails when more than one configuration is active', async ({ assert }) => {
    await createConfig({ version: 1 })
    await createConfig({ version: 2 })

    await expectConfigurationError(assert, 'found 2')
  })

  test('fails when the active configuration has no tiers', async ({ assert }) => {
    await createConfig({ tiers: [] })

    await expectConfigurationError(assert, 'no tiers')
  })

  test('fails when standardBusinessDays is not one of the tiers', async ({ assert }) => {
    await createConfig({ standardBusinessDays: 4, tiers: [5, 3, 2, 1] })

    await expectConfigurationError(assert, 'not one of the configured tiers')
  })

  test('fails rather than defaulting when growthRate would not increase cost', async ({
    assert,
  }) => {
    await createConfig({ growthRate: '1' })

    await expectConfigurationError(assert, 'growthRate')
  })
})

test.group('Production time configuration | fee formula', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('standard business days always price at exactly 0', async ({ assert }) => {
    await createConfig()
    const config = await getActiveProductionTimeConfig()

    assert.equal(computeProductionTimeFee(5, config), 0)
  })

  test('fee grows exponentially with days saved, matching the formula', async ({ assert }) => {
    await createConfig({ baseFee: '5.00', growthRate: '1.6', standardBusinessDays: 5 })
    const config = await getActiveProductionTimeConfig()

    // fee(daysSaved) = baseFee * (growthRate ^ daysSaved - 1), rounded to cents.
    assert.equal(computeProductionTimeFee(3, config), roundCurrency(5 * (1.6 ** 2 - 1)))
    assert.equal(computeProductionTimeFee(2, config), roundCurrency(5 * (1.6 ** 3 - 1)))
    assert.equal(computeProductionTimeFee(1, config), roundCurrency(5 * (1.6 ** 4 - 1)))

    // And strictly increasing as the turnaround gets faster.
    const fees = [5, 3, 2, 1].map((days) => computeProductionTimeFee(days, config))
    assert.isTrue(fees[0] < fees[1] && fees[1] < fees[2] && fees[2] < fees[3])
  })

  test('rejects a business-day count that is not a configured tier', async ({ assert }) => {
    await createConfig()
    const config = await getActiveProductionTimeConfig()

    assert.throws(() => computeProductionTimeFee(4, config), InvalidProductionTimeSelectionError)
  })
})

test.group('Production time configuration | feasibility guard', () => {
  test('feasible when the print fits inside the promised turnaround', ({ assert }) => {
    // 1 business day = 86400 seconds available.
    assert.isTrue(isProductionTimeFeasible(80_000, 1))
  })

  test('infeasible when the print does not fit inside the promised turnaround', ({ assert }) => {
    assert.isFalse(isProductionTimeFeasible(200_000, 1))
  })

  test('feasible (nothing to compare against) when print time is unknown', ({ assert }) => {
    assert.isTrue(isProductionTimeFeasible(null, 1))
  })
})
