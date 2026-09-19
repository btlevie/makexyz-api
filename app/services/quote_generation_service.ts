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
import type QuoteItem from '#models/quote_item'
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
import { createAddress } from '#services/address_service'
import { hasAnyCapableVendor } from '#services/order_routing_service'

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

/** Plain string column, not a DB enum - a future second trigger is just a new value here. */
export type QuoteReviewReason = 'unfulfillable_technology_mix'

/**
 * The distinct set of technologies a quote's items need a vendor to
 * fulfill - quote-item-level analog of
 * order_routing_service.ts#getRequiredTechnologies, for re-deriving this
 * without the in-memory pricing context persistQuote already has (e.g. from
 * the admin review queue).
 */
export async function getRequiredTechnologiesForQuote(quote: Quote): Promise<string[]> {
  await quote.load('items', (q) => q.preload('projectFile'))
  const technologies = new Set<string>()
  for (const item of quote.items) {
    if (item.projectFile) {
      technologies.add(item.projectFile.technology)
    }
  }
  return [...technologies]
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

  // Flags a quote that can't proceed as-is (e.g. its items span technologies
  // no single vendor covers) for review, rather than letting it silently
  // become an unfulfillable order later - see docs on Quote.status's
  // 'needs_review' value.
  const requiredTechnologies = [...new Set(pricedLines.map((line) => line.projectFile.technology))]
  const fulfillable = await hasAnyCapableVendor(requiredTechnologies)

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
        status: fulfillable ? 'draft' : 'needs_review',
        reviewReason: fulfillable ? null : ('unfulfillable_technology_mix' satisfies QuoteReviewReason),
        generatedBy: 'system',
        productionTimeBusinessDays: standardBusinessDays,
        // Explicit null, not omitted - an omitted FK leaves the in-memory
        // instance's addressId as `undefined`, which Lucid's belongsTo
        // preload (quote.load('address') in quotes_controller.ts) refuses to
        // treat as "no related row" and throws on instead of a real null.
        addressId: null,
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

/**
 * Either an existing saved address (looked up and ownership-checked by the
 * controller against the resolved project's customer) or the inline fields
 * to create a new one. Both branches carry the street-address fields
 * (not just `addressId` for 'existing') so the tax calculator always has
 * what it needs without a second lookup here.
 */
export type QuoteAddressInput =
  | {
      mode: 'existing'
      addressId: number
      line1: string
      line2: string | null
      city: string
      state: string | null
      postalCode: string
    }
  | {
      mode: 'new'
      recipientName: string
      line1: string
      line2?: string | null
      city: string
      state?: string | null
      postalCode: string
      label?: string | null
    }

export type QuoteConfigurationInput = {
  destinationCountry: string
  shippingMethod: ShippingMethod
  productionTimeBusinessDays: number
  address: QuoteAddressInput
}

export type ComputedQuotePricing = {
  shippingFeeAmount: number
  productionTimeFeeAmount: number
  taxAmount: number
  stripeTaxCalculationId: string
  total: number
}

/**
 * Shipping fee, production-time feasibility + fee, and tax - the real
 * pricing computation, shared by `configureQuote` (normal path) and
 * `quote_split_service.ts` (finalizing each resulting quote after a split).
 * Feasibility is checked against the slowest item in *this* `items` set, so
 * callers must pass the actual set that will be billed, not a superset.
 */
export async function computeShippingProductionAndTax(
  destinationCountry: string,
  shippingMethod: ShippingMethod,
  productionTimeBusinessDays: number,
  subtotal: number,
  items: QuoteItem[],
  destinationAddress: {
    line1: string
    line2?: string | null
    city: string
    state?: string | null
    postalCode: string
  }
): Promise<ComputedQuotePricing> {
  const shippingFeeAmount = resolveShippingFee(destinationCountry, shippingMethod)

  const productionTimeConfig = await getActiveProductionTimeConfig()
  const slowestPrintTimeSeconds = Math.max(
    0,
    ...(await Promise.all(
      items.map(async (item) => {
        await item.load('projectFile')
        return item.projectFile?.printTimeEstimatedSeconds ?? 0
      })
    ))
  )
  if (!isProductionTimeFeasible(slowestPrintTimeSeconds, productionTimeBusinessDays)) {
    throw new ProductionTimeInfeasibleError(
      `${productionTimeBusinessDays} business days is not enough time to produce this order`
    )
  }
  const productionTimeFeeAmount = computeProductionTimeFee(
    productionTimeBusinessDays,
    productionTimeConfig
  )

  const taxCalculator = getTaxCalculator()
  const { calculationId, taxAmount } = await taxCalculator.calculate({
    destinationCountry,
    destinationAddress: {
      line1: destinationAddress.line1,
      line2: destinationAddress.line2 ?? null,
      city: destinationAddress.city,
      state: destinationAddress.state ?? null,
      postalCode: destinationAddress.postalCode,
    },
    lineItems: [
      { description: 'Manufacturing', amount: subtotal },
      { description: 'Shipping', amount: shippingFeeAmount },
      { description: 'Production time', amount: productionTimeFeeAmount },
    ],
  })

  const total = roundCurrency(subtotal + shippingFeeAmount + productionTimeFeeAmount + taxAmount)

  return {
    shippingFeeAmount,
    productionTimeFeeAmount,
    taxAmount,
    stripeTaxCalculationId: calculationId,
    total,
  }
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
 * A `'needs_review'` quote is allowed through - the customer's destination/
 * shipping/production-time choice and address still get recorded on a new
 * revision, but shipping/production/tax computation is skipped entirely
 * (see computeShippingProductionAndTax above): checking production-time
 * feasibility against a still-combined, not-yet-split multi-technology item
 * set would be meaningless, and a real Stripe Tax call for a total that will
 * never be charged (the combined quote never reaches checkout) is pure
 * waste. The revision stays `'needs_review'`; pricing is computed once real
 * pricing makes sense - either by `quote_split_service.ts` per resulting
 * quote, or by a later `configure` call once the quote is no longer flagged.
 *
 * Throws QuoteNotConfigurableError if `latestQuote` isn't actually the
 * latest revision *within its own lineage* (stale client state; see
 * quotes.origin_quote_id - a project can have independent lineages once a
 * quote has been split) or is already accepted/rejected (a quote is frozen
 * once accepted - see docs/DATABASE_FLOW.md). Throws
 * ProductionTimeInfeasibleError if the selected turnaround doesn't fit the
 * slowest item's own print time. InvalidShippingSelectionError/
 * InvalidProductionTimeSelectionError propagate from the shipping/
 * production-time services for an invalid selection.
 */
export async function configureQuote(
  project: Project,
  latestQuote: Quote,
  input: QuoteConfigurationInput
): Promise<Quote> {
  if (
    latestQuote.status !== 'draft' &&
    latestQuote.status !== 'sent' &&
    latestQuote.status !== 'needs_review'
  ) {
    throw new QuoteNotConfigurableError(
      `Quote ${latestQuote.uuid} is ${latestQuote.status} and can no longer be configured`
    )
  }

  const lineageRoot = latestQuote.originQuoteId ?? latestQuote.id
  const currentLatest = await Quote.query()
    .where('projectId', project.id)
    .where((q) => q.where('id', lineageRoot).orWhere('originQuoteId', lineageRoot))
    .orderBy('revision', 'desc')
    .firstOrFail()
  if (currentLatest.id !== latestQuote.id) {
    throw new QuoteNotConfigurableError(
      `Quote ${latestQuote.uuid} (revision ${latestQuote.revision}) is no longer the latest revision for this project`
    )
  }

  await latestQuote.load('items')

  const needsReview = latestQuote.status === 'needs_review'
  const pricing = needsReview
    ? null
    : await computeShippingProductionAndTax(
        input.destinationCountry,
        input.shippingMethod,
        input.productionTimeBusinessDays,
        Number(latestQuote.subtotal),
        latestQuote.items,
        {
          line1: input.address.line1,
          line2: input.address.line2 ?? null,
          city: input.address.city,
          state: input.address.state ?? null,
          postalCode: input.address.postalCode,
        }
      )

  return db.transaction(async (trx) => {
    await Project.query({ client: trx }).where('id', project.id).forUpdate().first()

    let addressId: number
    if (input.address.mode === 'existing') {
      addressId = input.address.addressId
    } else {
      const address = await createAddress(
        {
          ownerType: 'customer',
          customerId: project.customerId ?? null,
          label: input.address.label ?? null,
          recipientName: input.address.recipientName,
          line1: input.address.line1,
          line2: input.address.line2 ?? null,
          city: input.address.city,
          state: input.address.state ?? null,
          postalCode: input.address.postalCode,
          country: input.destinationCountry,
        },
        trx
      )
      addressId = address.id
    }

    const configured = await Quote.create(
      {
        uuid: string.uuid(),
        projectId: project.id,
        createdById: latestQuote.createdById,
        originQuoteId: lineageRoot,
        revision: latestQuote.revision + 1,
        subtotal: latestQuote.subtotal,
        tax: pricing ? pricing.taxAmount.toFixed(2) : '0.00',
        total: pricing ? pricing.total.toFixed(2) : latestQuote.subtotal,
        status: needsReview ? 'needs_review' : 'draft',
        reviewReason: needsReview ? latestQuote.reviewReason : null,
        generatedBy: latestQuote.generatedBy,
        destinationCountry: input.destinationCountry,
        shippingMethod: input.shippingMethod,
        shippingFeeAmount: pricing ? pricing.shippingFeeAmount.toFixed(2) : null,
        productionTimeBusinessDays: input.productionTimeBusinessDays,
        productionTimeFeeAmount: pricing ? pricing.productionTimeFeeAmount.toFixed(2) : null,
        stripeTaxCalculationId: pricing ? pricing.stripeTaxCalculationId : null,
        addressId,
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
