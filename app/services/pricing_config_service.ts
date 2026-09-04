/**
 * Loads versioned pricing configuration out of the database.
 *
 * A calculation must never mix constants from two configuration versions, so
 * callers load ONE resolved snapshot here and pass it through the whole
 * calculation rather than reaching back to the database per constant.
 *
 * There is deliberately no in-code fallback configuration: if the active row is
 * missing, ambiguous, or malformed this throws. Quoting $0 because a constant
 * silently defaulted is far worse than refusing to quote.
 */
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import PricingConfig from '#models/pricing_config'
import {
  validateFdmPricingConfig,
  type ResolvedFdmPricingConfig,
} from '#services/fdm_pricing_calculator'

export class PricingConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PricingConfigurationError'
  }
}

/**
 * Stored decimals arrive as strings from Postgres and numbers from SQLite.
 * Normalize once, here, so the calculator only ever sees numbers.
 */
function toNumber(value: unknown, field: string, problems: string[]): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    problems.push(`${field} is not a finite number (got ${String(value)})`)
    return Number.NaN
  }
  return parsed
}

export async function getActiveFdmConfig(): Promise<ResolvedFdmPricingConfig> {
  const active = await PricingConfig.query()
    .where('technology', 'fdm')
    .where('isActive', true)
    .preload('fdmValues')

  if (active.length === 0) {
    throw new PricingConfigurationError(
      'No active FDM pricing configuration found. Seed or activate one before quoting.'
    )
  }
  if (active.length > 1) {
    const ids = active.map((config) => config.id).join(', ')
    throw new PricingConfigurationError(
      `Expected exactly one active FDM pricing configuration, found ${active.length} (ids: ${ids}).`
    )
  }

  const config = active[0]
  const values = config.fdmValues
  if (!values) {
    throw new PricingConfigurationError(
      `Active FDM pricing configuration ${config.id} (version ${config.version}) has no values row.`
    )
  }

  const problems: string[] = []
  const resolved: ResolvedFdmPricingConfig = {
    id: config.id,
    version: config.version,
    modelMaterialRatePerGram: toNumber(
      values.modelMaterialRatePerGram,
      'modelMaterialRatePerGram',
      problems
    ),
    supportMaterialRatePerGram: toNumber(
      values.supportMaterialRatePerGram,
      'supportMaterialRatePerGram',
      problems
    ),
    machineRatePerHour: toNumber(values.machineRatePerHour, 'machineRatePerHour', problems),
    failureBufferMultiplier: toNumber(
      values.failureBufferMultiplier,
      'failureBufferMultiplier',
      problems
    ),
    fixedLineItemCharge: toNumber(values.fixedLineItemCharge, 'fixedLineItemCharge', problems),
    bulkFloorSmallMultiplier: toNumber(
      values.bulkFloorSmallMultiplier,
      'bulkFloorSmallMultiplier',
      problems
    ),
    bulkFloorLargeMultiplier: toNumber(
      values.bulkFloorLargeMultiplier,
      'bulkFloorLargeMultiplier',
      problems
    ),
    bulkFloorBreakGrams: toNumber(values.bulkFloorBreakGrams, 'bulkFloorBreakGrams', problems),
    bulkFloorSigmoidWidthGrams: toNumber(
      values.bulkFloorSigmoidWidthGrams,
      'bulkFloorSigmoidWidthGrams',
      problems
    ),
    quantityDecayConstant: toNumber(
      values.quantityDecayConstant,
      'quantityDecayConstant',
      problems
    ),
    oversizeThresholdMm: toNumber(values.oversizeThresholdMm, 'oversizeThresholdMm', problems),
    oversizeMultiplier: toNumber(values.oversizeMultiplier, 'oversizeMultiplier', problems),
  }

  if (problems.length > 0) {
    throw new PricingConfigurationError(
      `Active FDM pricing configuration ${config.id} (version ${config.version}) is malformed: ${problems.join('; ')}`
    )
  }

  // Same rules the calculator enforces, applied at load time so a bad
  // configuration is caught before any quote work starts. Rewrapped so that every
  // way a configuration can be unusable - absent, ambiguous, incomplete or
  // invalid - reaches callers as one error type.
  try {
    validateFdmPricingConfig(resolved)
  } catch (error) {
    throw new PricingConfigurationError(
      `Active FDM pricing configuration ${config.id} (version ${config.version}) is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  return resolved
}

/**
 * Makes one configuration the active one for its technology, deactivating any
 * other. Wrapped in a transaction so there is never a moment with two active
 * rows (or none) for a technology.
 */
export async function activateConfig(pricingConfigId: number): Promise<PricingConfig> {
  return db.transaction(async (trx) => {
    const config = await PricingConfig.findOrFail(pricingConfigId, { client: trx })

    await PricingConfig.query({ client: trx })
      .where('technology', config.technology)
      .whereNot('id', config.id)
      .update({ is_active: false })

    config.isActive = true
    config.activatedAt = DateTime.now()
    await config.useTransaction(trx).save()

    return config
  })
}
