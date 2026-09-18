/**
 * Builds a priced quote revision for a project.
 *
 * Shared by the explicit quote endpoint and the automatic quoting that runs when
 * a project's files finish slicing, so the two can never price differently.
 */
import string from '@adonisjs/core/helpers/string'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Project from '#models/project'
import type ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import {
  calculateFdmPrice,
  roundCurrency,
  InvalidPricingInputError,
  type FdmPricingResult,
  type ResolvedFdmPricingConfig,
} from '#services/fdm_pricing_calculator'
import { buildFdmPricingInputs } from '#services/project_file_pricing_inputs'
import { resolveShippingFee, type ShippingMethod } from '#services/shipping_service'
import {
  computeProductionTimeFee,
  getActiveProductionTimeConfig,
  isProductionTimeFeasible,
} from '#services/production_time_service'
import { getTaxCalculator } from '#services/tax_calculator_service'

export type QuoteLineRequest = { projectFile: ProjectFile; quantity: number }

/**
 * One resolved config per technology that currently has a real pricing
 * calculator. Only `fdm` exists today - `sla`/`sls` are added here (not as a
 * signature change to priceLine) once their calculators and config tables
 * exist, per docs/DATABASE_FLOW.md's staged rollout.
 */
export type ResolvedPricingConfigs = {
  fdm: ResolvedFdmPricingConfig
}

export class UnpriceableLineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnpriceableLineError'
  }
}

/**
 * Prices one line. Throws UnpriceableLineError when the file can't be priced -
 * callers decide whether that fails the request or merely drops the line.
 *
 * Dispatches on the file's technology so a project mixing e.g. FDM and SLA
 * files prices each line against the right calculator/config once SLA has
 * one - today only 'fdm' has a real case, everything else is unpriceable.
 */
export function priceLine(
  project: Project,
  { projectFile, quantity }: QuoteLineRequest,
  configs: ResolvedPricingConfigs
): FdmPricingResult {
  if (!projectFile.material) {
    throw new UnpriceableLineError(`Project file ${projectFile.uuid} has no material assigned`)
  }

  switch (projectFile.technology) {
    case 'fdm':
      return priceFdmLine(project, projectFile, quantity, configs.fdm)
    case 'sla':
    case 'sls':
      throw new UnpriceableLineError(
        `Project file ${projectFile.uuid} technology "${projectFile.technology}" is not priceable yet`
      )
    default:
      throw new UnpriceableLineError(
        `Project file ${projectFile.uuid} has an unrecognized technology "${projectFile.technology}"`
      )
  }
}

function priceFdmLine(
  project: Project,
  projectFile: ProjectFile,
  quantity: number,
  config: ResolvedFdmPricingConfig
): FdmPricingResult {
  try {
    const result = calculateFdmPrice(
      buildFdmPricingInputs(projectFile, projectFile.material!, quantity),
      config
    )

    if (result.calculation.bulkFloorExceedsVariablePrice) {
      logger.warn(
        {
          projectFileUuid: projectFile.uuid,
          pricingConfigId: config.id,
          bulkFloorPrice: result.calculation.bulkFloorPrice,
          variablePrice: result.calculation.variablePrice,
        },
        'Bulk floor exceeds the variable price; unit price rises with quantity'
      )
    }

    logger.info(
      {
        projectUuid: project.uuid,
        projectFileUuid: projectFile.uuid,
        pricingConfigId: config.id,
        pricingConfigVersion: config.version,
        quantity: result.quantity,
        modelGrams: result.slicerInputs.modelGrams,
        supportGrams: result.slicerInputs.supportGrams,
        printHours: result.slicerInputs.printHours,
        variablePrice: result.calculation.variablePrice,
        bulkUnitPrice: result.calculation.bulkUnitPrice,
        isOversize: result.calculation.isOversize,
        finalPrice: result.calculation.finalPrice,
      },
      'Priced quote line item'
    )

    return result
  } catch (error) {
    if (error instanceof InvalidPricingInputError) {
      throw new UnpriceableLineError(error.message)
    }
    throw error
  }
}

/**
 * Persists a new quote revision from already-priced lines.
 *
 * Locks the project row before reading the latest revision: files finish slicing
 * in parallel and SQS delivers at least once, so two callers can otherwise
 * observe the same "latest" and both write revision N+1.
 */
export async function persistQuote(
  project: Project,
  pricedLines: { projectFile: ProjectFile; result: FdmPricingResult }[],
  options: { createdById?: number | null; trx?: TransactionClientContract } = {}
): Promise<Quote> {
  const subtotal = roundCurrency(
    pricedLines.reduce((sum, line) => sum + line.result.calculation.finalPriceRounded, 0)
  )

  // Best-effort: an initial quote has no destination yet, so tax can't be
  // computed and shipping isn't chosen - only the production-time default is
  // knowable up front. Missing/invalid config must not block quote creation
  // itself; configureQuote is what actually requires a valid one.
  let standardBusinessDays: number | null = null
  try {
    standardBusinessDays = (await getActiveProductionTimeConfig()).standardBusinessDays
  } catch {
    standardBusinessDays = null
  }

  const run = async (trx: TransactionClientContract) => {
    // Row lock, not a model refresh - this is what serializes concurrent
    // callers so they can't both read the same latest revision.
    await Project.query({ client: trx }).where('id', project.id).forUpdate().first()

    const latest = await Quote.query({ client: trx })
      .where('projectId', project.id)
      .orderBy('revision', 'desc')
      .first()

    const quote = await Quote.create(
      {
        uuid: string.uuid(),
        projectId: project.id,
        // Null for system-generated anonymous quotes - there is no author.
        createdById: options.createdById ?? null,
        revision: (latest?.revision ?? 0) + 1,
        subtotal: subtotal.toFixed(2),
        // Not yet known - no destination to calculate tax against until the
        // customer configures the quote (see configureQuote below).
        tax: '0.00',
        total: subtotal.toFixed(2),
        status: 'draft',
        generatedBy: 'system',
        productionTimeBusinessDays: standardBusinessDays,
      },
      { client: trx }
    )

    await quote.related('items').createMany(
      pricedLines.map(({ projectFile, result }) => ({
        projectFileId: projectFile.id,
        itemType: 'printing',
        description: projectFile.originalName,
        quantity: result.quantity,
        // Display convenience only. Because it is rounded before display,
        // unitPrice * quantity will not always equal total - the authoritative
        // figures are total and the full-precision pricingSnapshot.
        unitPrice: roundCurrency(result.calculation.finalPrice / result.quantity).toFixed(2),
        total: result.calculation.finalPriceRounded.toFixed(2),
        // Read from the line's own result, not a single shared config - once a
        // quote can mix technologies, different lines are priced against
        // different configs.
        pricingConfigId: result.pricingConfiguration.id,
        pricingSnapshot: result,
      }))
    )

    return quote
  }

  return options.trx ? run(options.trx) : db.transaction(run)
}

export class QuoteNotConfigurableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuoteNotConfigurableError'
  }
}

export class ProductionTimeInfeasibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionTimeInfeasibleError'
  }
}

export type QuoteConfigurationInput = {
  destinationCountry: string
  shippingMethod: ShippingMethod
  productionTimeBusinessDays: number
}

/**
 * Sets/updates shipping, production time, and tax on a quote - the customer-
 * facing "configure before you accept" step. Manufacturing prices are NOT
 * recomputed here: the existing quote's items are cloned forward unchanged
 * into a new revision, so this can't accidentally reprice a part just because
 * the customer picked a shipping method (and can't drift from a pricing-config
 * change happening concurrently, since it never re-reads pricing config at
 * all).
 *
 * Throws QuoteNotConfigurableError if `latestQuote` isn't actually the
 * project's latest revision (stale client state) or is already
 * accepted/rejected (a quote is frozen once accepted - see
 * docs/DATABASE_FLOW.md). Throws ProductionTimeInfeasibleError if the
 * selected turnaround doesn't fit the slowest item's own print time.
 * InvalidShippingSelectionError/InvalidProductionTimeSelectionError propagate
 * from the shipping/production-time services for an invalid selection.
 */
export async function configureQuote(
  project: Project,
  latestQuote: Quote,
  input: QuoteConfigurationInput
): Promise<Quote> {
  if (latestQuote.status !== 'draft' && latestQuote.status !== 'sent') {
    throw new QuoteNotConfigurableError(
      `Quote ${latestQuote.uuid} is ${latestQuote.status} and can no longer be configured`
    )
  }

  const currentLatest = await Quote.query()
    .where('projectId', project.id)
    .orderBy('revision', 'desc')
    .firstOrFail()
  if (currentLatest.id !== latestQuote.id) {
    throw new QuoteNotConfigurableError(
      `Quote ${latestQuote.uuid} (revision ${latestQuote.revision}) is no longer the latest revision for this project`
    )
  }

  await latestQuote.load('items')

  const shippingFeeAmount = resolveShippingFee(input.destinationCountry, input.shippingMethod)

  const productionTimeConfig = await getActiveProductionTimeConfig()
  const slowestPrintTimeSeconds = Math.max(
    0,
    ...(await Promise.all(
      latestQuote.items.map(async (item) => {
        await item.load('projectFile')
        return item.projectFile?.printTimeEstimatedSeconds ?? 0
      })
    ))
  )
  if (!isProductionTimeFeasible(slowestPrintTimeSeconds, input.productionTimeBusinessDays)) {
    throw new ProductionTimeInfeasibleError(
      `${input.productionTimeBusinessDays} business days is not enough time to produce this order`
    )
  }
  const productionTimeFeeAmount = computeProductionTimeFee(
    input.productionTimeBusinessDays,
    productionTimeConfig
  )

  const subtotal = Number(latestQuote.subtotal)
  const taxCalculator = getTaxCalculator()
  const { calculationId, taxAmount } = await taxCalculator.calculate({
    destinationCountry: input.destinationCountry,
    lineItems: [
      { description: 'Manufacturing', amount: subtotal },
      { description: 'Shipping', amount: shippingFeeAmount },
      { description: 'Production time', amount: productionTimeFeeAmount },
    ],
  })

  const total = roundCurrency(subtotal + shippingFeeAmount + productionTimeFeeAmount + taxAmount)

  return db.transaction(async (trx) => {
    await Project.query({ client: trx }).where('id', project.id).forUpdate().first()

    const configured = await Quote.create(
      {
        uuid: string.uuid(),
        projectId: project.id,
        createdById: latestQuote.createdById,
        revision: latestQuote.revision + 1,
        subtotal: latestQuote.subtotal,
        tax: taxAmount.toFixed(2),
        total: total.toFixed(2),
        status: 'draft',
        generatedBy: latestQuote.generatedBy,
        destinationCountry: input.destinationCountry,
        shippingMethod: input.shippingMethod,
        shippingFeeAmount: shippingFeeAmount.toFixed(2),
        productionTimeBusinessDays: input.productionTimeBusinessDays,
        productionTimeFeeAmount: productionTimeFeeAmount.toFixed(2),
        stripeTaxCalculationId: calculationId,
      },
      { client: trx }
    )

    await configured.related('items').createMany(
      latestQuote.items.map((item) => ({
        projectFileId: item.projectFileId,
        itemType: item.itemType,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
        pricingConfigId: item.pricingConfigId,
        pricingSnapshot: item.pricingSnapshot,
      }))
    )

    return configured
  })
}
