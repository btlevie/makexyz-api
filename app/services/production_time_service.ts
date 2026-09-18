/**
 * Production-time (rush) pricing.
 *
 * Technology-agnostic, unlike pricing_config_service - the same exponential
 * formula and tier set apply regardless of FDM/SLA/SLS, so there is no
 * per-technology values table here.
 *
 * There is deliberately no in-code fallback configuration - same reasoning as
 * pricing_config_service: quoting $0 rush because a constant silently
 * defaulted is far worse than refusing to quote.
 */
import ProductionTimeConfig from '#models/production_time_config'
import { roundCurrency } from '#services/fdm_pricing_calculator'

export class ProductionTimeConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionTimeConfigurationError'
  }
}

export class InvalidProductionTimeSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidProductionTimeSelectionError'
  }
}

export type ResolvedProductionTimeConfig = {
  id: number
  version: number
  standardBusinessDays: number
  baseFee: number
  growthRate: number
  /** Every selectable business-day count, including the standard/free one. */
  tierBusinessDays: number[]
}

function toNumber(value: unknown, field: string, problems: string[]): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    problems.push(`${field} is not a finite number (got ${String(value)})`)
    return Number.NaN
  }
  return parsed
}

export async function getActiveProductionTimeConfig(): Promise<ResolvedProductionTimeConfig> {
  const active = await ProductionTimeConfig.query().where('isActive', true).preload('tiers')

  if (active.length === 0) {
    throw new ProductionTimeConfigurationError(
      'No active production-time configuration found. Seed or activate one before quoting.'
    )
  }
  if (active.length > 1) {
    const ids = active.map((config) => config.id).join(', ')
    throw new ProductionTimeConfigurationError(
      `Expected exactly one active production-time configuration, found ${active.length} (ids: ${ids}).`
    )
  }

  const config = active[0]
  if (config.tiers.length === 0) {
    throw new ProductionTimeConfigurationError(
      `Active production-time configuration ${config.id} (version ${config.version}) has no tiers.`
    )
  }

  const problems: string[] = []
  const baseFee = toNumber(config.baseFee, 'baseFee', problems)
  const growthRate = toNumber(config.growthRate, 'growthRate', problems)
  const tierBusinessDays = config.tiers.map((tier) => tier.businessDays).sort((a, b) => b - a)

  if (!tierBusinessDays.includes(config.standardBusinessDays)) {
    problems.push(
      `standardBusinessDays (${config.standardBusinessDays}) is not one of the configured tiers (${tierBusinessDays.join(', ')})`
    )
  }
  if (baseFee < 0) {
    problems.push(`baseFee must not be negative (got ${baseFee})`)
  }
  if (growthRate <= 1) {
    problems.push(`growthRate must be greater than 1 for cost to increase with speed (got ${growthRate})`)
  }

  if (problems.length > 0) {
    throw new ProductionTimeConfigurationError(
      `Active production-time configuration ${config.id} (version ${config.version}) is invalid: ${problems.join('; ')}`
    )
  }

  return {
    id: config.id,
    version: config.version,
    standardBusinessDays: config.standardBusinessDays,
    baseFee,
    growthRate,
    tierBusinessDays,
  }
}

/**
 * fee(daysSaved) = baseFee * (growthRate ^ daysSaved - 1), where
 * daysSaved = standardBusinessDays - selectedBusinessDays. Standard itself
 * (daysSaved === 0) always prices at exactly 0, not an approximation of it.
 *
 * Throws InvalidProductionTimeSelectionError for a day count that isn't one of
 * the configured tiers - callers decide whether that fails the request.
 */
export function computeProductionTimeFee(
  selectedBusinessDays: number,
  config: ResolvedProductionTimeConfig
): number {
  if (!config.tierBusinessDays.includes(selectedBusinessDays)) {
    throw new InvalidProductionTimeSelectionError(
      `${selectedBusinessDays} business days is not a configured production-time tier (${config.tierBusinessDays.join(', ')})`
    )
  }

  const daysSaved = config.standardBusinessDays - selectedBusinessDays
  if (daysSaved <= 0) {
    return 0
  }

  return roundCurrency(config.baseFee * (config.growthRate ** daysSaved - 1))
}

/**
 * A rush tier is only worth offering if the part's own estimated print time
 * fits inside the promised turnaround - correctness (don't sell an
 * undeliverable promise), not a vendor-capacity system. printTimeEstimatedSeconds
 * is per-part; this compares it against the calendar time a business-day count
 * represents (24h/business day - a conservative floor, not a real production
 * calendar).
 */
export function isProductionTimeFeasible(
  printTimeEstimatedSeconds: number | null,
  selectedBusinessDays: number
): boolean {
  if (printTimeEstimatedSeconds === null) {
    return true
  }

  const availableSeconds = selectedBusinessDays * 24 * 60 * 60
  return printTimeEstimatedSeconds <= availableSeconds
}
