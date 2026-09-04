import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import PricingConfig from '#models/pricing_config'
import {
  activateConfig,
  getActiveFdmConfig,
  PricingConfigurationError,
} from '#services/pricing_config_service'

const DEFAULT_VALUES = {
  modelMaterialRatePerGram: '0.15',
  supportMaterialRatePerGram: '0.30',
  machineRatePerHour: '2.00',
  failureBufferMultiplier: '1.10',
  fixedLineItemCharge: '7.50',
  bulkFloorSmallMultiplier: '10.00',
  bulkFloorLargeMultiplier: '3.25',
  bulkFloorBreakGrams: '75.00',
  bulkFloorSigmoidWidthGrams: '15.00',
  quantityDecayConstant: '18.00',
  oversizeThresholdMm: '325.00',
  oversizeMultiplier: '1.30',
}

async function createConfig(
  options: {
    version?: number
    isActive?: boolean
    withValues?: boolean
    values?: Partial<typeof DEFAULT_VALUES>
  } = {}
) {
  const config = await PricingConfig.create({
    technology: 'fdm',
    name: `FDM pricing v${options.version ?? 1}`,
    version: options.version ?? 1,
    isActive: options.isActive ?? true,
  })

  if (options.withValues !== false) {
    await config.related('fdmValues').create({ ...DEFAULT_VALUES, ...options.values })
  }

  return config
}

async function expectConfigurationError(assert: any, message: string) {
  try {
    await getActiveFdmConfig()
    assert.fail('expected PricingConfigurationError')
  } catch (error) {
    assert.instanceOf(error, PricingConfigurationError)
    assert.include((error as Error).message.toLowerCase(), message.toLowerCase())
  }
}

test.group('Pricing configuration | loading', (group) => {
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

  test('resolves every constant as a number', async ({ assert }) => {
    const created = await createConfig()

    const config = await getActiveFdmConfig()

    assert.equal(config.id, created.id)
    assert.equal(config.version, 1)
    for (const [key, value] of Object.entries(config)) {
      assert.isNumber(value, `${key} should be a number`)
      assert.isTrue(Number.isFinite(value), `${key} should be finite`)
    }
    assert.equal(config.modelMaterialRatePerGram, 0.15)
    assert.equal(config.oversizeThresholdMm, 325)
    assert.equal(config.oversizeMultiplier, 1.3)
  })

  test('fails when no configuration is active', async ({ assert }) => {
    await createConfig({ isActive: false })

    await expectConfigurationError(assert, 'no active fdm pricing configuration')
  })

  test('fails when more than one configuration is active', async ({ assert }) => {
    await createConfig({ version: 1 })
    await createConfig({ version: 2 })

    await expectConfigurationError(assert, 'found 2')
  })

  test('fails when the active configuration has no values row', async ({ assert }) => {
    await createConfig({ withValues: false })

    await expectConfigurationError(assert, 'no values row')
  })

  test('fails rather than defaulting when a constant is invalid', async ({ assert }) => {
    await createConfig({ values: { quantityDecayConstant: '0' } })

    await expectConfigurationError(assert, 'quantityDecayConstant')
  })

  test('ignores configurations belonging to another technology version', async ({ assert }) => {
    await createConfig({ version: 1, isActive: false })
    const active = await createConfig({ version: 2, isActive: true })

    const config = await getActiveFdmConfig()

    assert.equal(config.id, active.id)
    assert.equal(config.version, 2)
  })
})

test.group('Pricing configuration | activation', (group) => {
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

  test('activating a configuration deactivates the previous one', async ({ assert }) => {
    const first = await createConfig({ version: 1, isActive: true })
    const second = await createConfig({ version: 2, isActive: false })

    await activateConfig(second.id)

    await first.refresh()
    await second.refresh()
    assert.isFalse(first.isActive)
    assert.isTrue(second.isActive)
    assert.isNotNull(second.activatedAt)

    // And the newly activated version is what quoting will now load.
    const config = await getActiveFdmConfig()
    assert.equal(config.id, second.id)
    assert.equal(config.version, 2)
  })

  test('leaves exactly one active configuration after repeated activation', async ({
    assert,
  }) => {
    const first = await createConfig({ version: 1, isActive: true })
    const second = await createConfig({ version: 2, isActive: false })

    await activateConfig(second.id)
    await activateConfig(first.id)
    await activateConfig(second.id)

    const activeCount = await PricingConfig.query().where('isActive', true)
    assert.lengthOf(activeCount, 1)
    assert.equal(activeCount[0].id, second.id)
  })
})
