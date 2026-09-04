/**
 * FDM line-item pricing.
 *
 * Pure calculation only: no database access, no HTTP, no logging. Callers load a
 * single resolved pricing configuration snapshot (see pricing_config_service) and
 * pass it in, so every number in one calculation comes from one configuration
 * version and the same inputs always produce the same output.
 *
 * Deliberately NOT handled here - these belong to cart/checkout:
 *   shipping, tax, checkout/payment fees, cart minimums, and any per-part or
 *   per-line minimum price. A line item is allowed to price below $30.
 */

/** Slicer-derived manufacturing facts for ONE part, already normalized. */
export type FdmPricingInputs = {
  /** Number of identical parts. Positive integer. */
  quantity: number
  /** Filament attributed to the model itself, grams per part. */
  modelGrams: number
  /** Support + support-interface filament, grams per part. */
  supportGrams: number
  /** Print time for ONE part, in decimal hours. */
  printHours: number
  /** Internal filament cost, USD per gram (e.g. a $20/kg spool -> 0.02). */
  trueFilamentCostPerGram: number
  /** Bounding box, millimeters. */
  xMm: number
  yMm: number
  zMm: number
  /**
   * Retained for auditing//future pricing rules; none of these affect the
   * current formula.
   */
  supportBaseGrams?: number | null
  supportInterfaceGrams?: number | null
  otherProcessGrams?: number | null
  totalFilamentGrams?: number | null
}

/**
 * A pricing configuration with every constant already converted from its stored
 * decimal string to a number, exactly once, by the config service.
 */
export type ResolvedFdmPricingConfig = {
  id: number
  version: number
  modelMaterialRatePerGram: number
  supportMaterialRatePerGram: number
  machineRatePerHour: number
  failureBufferMultiplier: number
  fixedLineItemCharge: number
  bulkFloorSmallMultiplier: number
  bulkFloorLargeMultiplier: number
  bulkFloorBreakGrams: number
  bulkFloorSigmoidWidthGrams: number
  quantityDecayConstant: number
  oversizeThresholdMm: number
  oversizeMultiplier: number
}

export type FdmPricingResult = {
  quantity: number
  slicerInputs: {
    modelGrams: number
    supportGrams: number
    supportBaseGrams: number | null
    supportInterfaceGrams: number | null
    otherProcessGrams: number | null
    totalFilamentGrams: number | null
    printHours: number
    trueFilamentCostPerGram: number
    dimensionsMm: { x: number; y: number; z: number }
  }
  pricingConfiguration: { id: number; version: number }
  calculation: {
    modelCharge: number
    supportCharge: number
    machineCharge: number
    preBufferVariablePrice: number
    failureBufferMultiplier: number
    /** Per-part variable price after the failure buffer (P_var). */
    variablePrice: number

    /** Bulk-only (null when quantity === 1). */
    trueModelMaterialCost: number | null
    bulkFloorMultiplier: number | null
    bulkFloorPrice: number | null
    quantityDecayFactor: number | null
    bulkUnitPrice: number | null
    /**
     * True when the configured floor sits above the normal variable price, which
     * makes unit price rise toward the floor as quantity grows. Mathematically
     * consistent with the configured floor but unusual; surfaced so callers can
     * log/monitor rather than silently swallowing it.
     */
    bulkFloorExceedsVariablePrice: boolean | null

    partsPrice: number
    fixedLineItemCharge: number
    linePriceBeforeOversize: number

    maxDimensionMm: number
    isOversize: boolean
    oversizeMultiplier: number

    /** Full precision - preserved for auditing. */
    finalPrice: number
    /** Customer-facing amount, rounded to currency precision. */
    finalPriceRounded: number
  }
}

export class InvalidPricingInputError extends Error {
  constructor(problems: string[]) {
    super(`Invalid FDM pricing inputs: ${problems.join('; ')}`)
    this.name = 'InvalidPricingInputError'
  }
}

export class InvalidPricingConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid FDM pricing configuration: ${problems.join('; ')}`)
    this.name = 'InvalidPricingConfigError'
  }
}

/**
 * Rounds to currency precision. Nudged by EPSILON so values that are a hair below
 * a half-cent purely through binary floating-point (e.g. 23.45 * 1.30 landing on
 * 30.484999999999996) still round the way the decimal arithmetic would.
 */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

export function validateFdmPricingInputs(inputs: FdmPricingInputs): void {
  const problems: string[] = []

  if (!Number.isInteger(inputs.quantity) || inputs.quantity < 1) {
    problems.push(`quantity must be an integer >= 1 (got ${inputs.quantity})`)
  }

  const nonNegative: [keyof FdmPricingInputs, number][] = [
    ['modelGrams', inputs.modelGrams],
    ['supportGrams', inputs.supportGrams],
    ['printHours', inputs.printHours],
    ['trueFilamentCostPerGram', inputs.trueFilamentCostPerGram],
  ]
  for (const [name, value] of nonNegative) {
    if (!isNonNegativeFinite(value)) {
      problems.push(`${name} must be a finite number >= 0 (got ${value})`)
    }
  }

  const positiveDimensions: [string, number][] = [
    ['xMm', inputs.xMm],
    ['yMm', inputs.yMm],
    ['zMm', inputs.zMm],
  ]
  for (const [name, value] of positiveDimensions) {
    if (!Number.isFinite(value) || value <= 0) {
      problems.push(`${name} must be a finite number > 0 (got ${value})`)
    }
  }

  if (problems.length > 0) {
    throw new InvalidPricingInputError(problems)
  }
}

export function validateFdmPricingConfig(config: ResolvedFdmPricingConfig): void {
  const problems: string[] = []

  // Rates may legitimately be zero (an admin can zero out a charge); negative or
  // non-finite is always a misconfiguration.
  const nonNegative: [string, number][] = [
    ['modelMaterialRatePerGram', config.modelMaterialRatePerGram],
    ['supportMaterialRatePerGram', config.supportMaterialRatePerGram],
    ['machineRatePerHour', config.machineRatePerHour],
    ['fixedLineItemCharge', config.fixedLineItemCharge],
    ['bulkFloorBreakGrams', config.bulkFloorBreakGrams],
  ]
  for (const [name, value] of nonNegative) {
    if (!isNonNegativeFinite(value)) {
      problems.push(`${name} must be a finite number >= 0 (got ${value})`)
    }
  }

  // These are divisors or multipliers where zero would either divide by zero or
  // collapse the price to nothing.
  const strictlyPositive: [string, number][] = [
    ['failureBufferMultiplier', config.failureBufferMultiplier],
    ['bulkFloorSmallMultiplier', config.bulkFloorSmallMultiplier],
    ['bulkFloorLargeMultiplier', config.bulkFloorLargeMultiplier],
    ['bulkFloorSigmoidWidthGrams', config.bulkFloorSigmoidWidthGrams],
    ['quantityDecayConstant', config.quantityDecayConstant],
    ['oversizeThresholdMm', config.oversizeThresholdMm],
    ['oversizeMultiplier', config.oversizeMultiplier],
  ]
  for (const [name, value] of strictlyPositive) {
    if (!Number.isFinite(value) || value <= 0) {
      problems.push(`${name} must be a finite number > 0 (got ${value})`)
    }
  }

  if (problems.length > 0) {
    throw new InvalidPricingConfigError(problems)
  }
}

/**
 * Sigmoid bulk floor multiplier.
 *
 *   M(g) = M_large + (M_small - M_large) / (1 + exp((g - G_break) / width))
 *
 * Approaches M_small for light parts, M_large for heavy ones, and sits exactly
 * halfway between them at g === G_break. The range is derived from both endpoints
 * rather than hard-coded, so an admin can move either endpoint independently.
 */
export function calculateBulkFloorMultiplier(
  modelGrams: number,
  config: ResolvedFdmPricingConfig
): number {
  const multiplierRange = config.bulkFloorSmallMultiplier - config.bulkFloorLargeMultiplier
  const exponent = (modelGrams - config.bulkFloorBreakGrams) / config.bulkFloorSigmoidWidthGrams

  return config.bulkFloorLargeMultiplier + multiplierRange / (1 + Math.exp(exponent))
}

/** D(Q) = exp(-(Q - 1) / decay_constant). 1 at Q=1, approaching 0 as Q grows. */
export function calculateQuantityDecayFactor(
  quantity: number,
  config: ResolvedFdmPricingConfig
): number {
  return Math.exp(-(quantity - 1) / config.quantityDecayConstant)
}

export function calculateFdmPrice(
  inputs: FdmPricingInputs,
  config: ResolvedFdmPricingConfig
): FdmPricingResult {
  validateFdmPricingInputs(inputs)
  validateFdmPricingConfig(config)

  const { quantity, modelGrams, supportGrams, printHours } = inputs

  const modelCharge = modelGrams * config.modelMaterialRatePerGram
  const supportCharge = supportGrams * config.supportMaterialRatePerGram
  const machineCharge = printHours * config.machineRatePerHour
  const preBufferVariablePrice = modelCharge + supportCharge + machineCharge

  // P_var - per part, and deliberately WITHOUT the fixed line-item charge, which
  // is added once per line further down.
  const variablePrice = preBufferVariablePrice * config.failureBufferMultiplier

  let trueModelMaterialCost: number | null = null
  let bulkFloorMultiplier: number | null = null
  let bulkFloorPrice: number | null = null
  let quantityDecayFactor: number | null = null
  let bulkUnitPrice: number | null = null
  let bulkFloorExceedsVariablePrice: boolean | null = null
  let partsPrice: number

  if (quantity === 1) {
    // Single-part branch. Q=1 is handled explicitly rather than falling through
    // the bulk math (where D(1) = 1 would reduce to the same number) because the
    // business logic is defined through this branch.
    partsPrice = variablePrice
  } else {
    // The floor is built from TRUE material cost - all filament that physically
    // gets extruded, model plus support - and nothing else: no machine time, no
    // fixed charge. Total grams also drive the sigmoid, so the floor multiplier
    // reflects the whole part as printed rather than the model alone.
    trueModelMaterialCost = (modelGrams + supportGrams) * inputs.trueFilamentCostPerGram
    bulkFloorMultiplier = calculateBulkFloorMultiplier(modelGrams + supportGrams, config)
    bulkFloorPrice = trueModelMaterialCost * bulkFloorMultiplier
    quantityDecayFactor = calculateQuantityDecayFactor(quantity, config)

    bulkUnitPrice = bulkFloorPrice + (variablePrice - bulkFloorPrice) * quantityDecayFactor
    bulkFloorExceedsVariablePrice = bulkFloorPrice > variablePrice

    partsPrice = quantity * bulkUnitPrice
  }

  // One fixed charge per line item, never multiplied by quantity.
  const linePriceBeforeOversize = partsPrice + config.fixedLineItemCharge

  // Strictly greater than: a part measuring exactly the threshold is NOT oversize.
  const maxDimensionMm = Math.max(inputs.xMm, inputs.yMm, inputs.zMm)
  const isOversize = maxDimensionMm > config.oversizeThresholdMm

  // Applied to the whole line price, fixed charge included.
  const finalPrice = isOversize
    ? linePriceBeforeOversize * config.oversizeMultiplier
    : linePriceBeforeOversize

  if (!Number.isFinite(finalPrice)) {
    throw new InvalidPricingInputError([
      `calculation produced a non-finite final price (${finalPrice})`,
    ])
  }

  return {
    quantity,
    slicerInputs: {
      modelGrams,
      supportGrams,
      supportBaseGrams: inputs.supportBaseGrams ?? null,
      supportInterfaceGrams: inputs.supportInterfaceGrams ?? null,
      otherProcessGrams: inputs.otherProcessGrams ?? null,
      totalFilamentGrams: inputs.totalFilamentGrams ?? null,
      printHours,
      trueFilamentCostPerGram: inputs.trueFilamentCostPerGram,
      dimensionsMm: { x: inputs.xMm, y: inputs.yMm, z: inputs.zMm },
    },
    pricingConfiguration: { id: config.id, version: config.version },
    calculation: {
      modelCharge,
      supportCharge,
      machineCharge,
      preBufferVariablePrice,
      failureBufferMultiplier: config.failureBufferMultiplier,
      variablePrice,
      trueModelMaterialCost,
      bulkFloorMultiplier,
      bulkFloorPrice,
      quantityDecayFactor,
      bulkUnitPrice,
      bulkFloorExceedsVariablePrice,
      partsPrice,
      fixedLineItemCharge: config.fixedLineItemCharge,
      linePriceBeforeOversize,
      maxDimensionMm,
      isOversize,
      oversizeMultiplier: config.oversizeMultiplier,
      finalPrice,
      finalPriceRounded: roundCurrency(finalPrice),
    },
  }
}
