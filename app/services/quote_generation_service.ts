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

export type QuoteLineRequest = { projectFile: ProjectFile; quantity: number }

export class UnpriceableLineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnpriceableLineError'
  }
}

/**
 * Prices one line. Throws UnpriceableLineError when the file can't be priced -
 * callers decide whether that fails the request or merely drops the line.
 */
export function priceLine(
  project: Project,
  { projectFile, quantity }: QuoteLineRequest,
  config: ResolvedFdmPricingConfig
): FdmPricingResult {
  if (projectFile.technology !== 'fdm') {
    throw new UnpriceableLineError(
      `Project file ${projectFile.uuid} technology "${projectFile.technology}" is not priceable yet`
    )
  }

  if (!projectFile.material) {
    throw new UnpriceableLineError(`Project file ${projectFile.uuid} has no material assigned`)
  }

  try {
    const result = calculateFdmPrice(
      buildFdmPricingInputs(projectFile, projectFile.material, quantity),
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
  config: ResolvedFdmPricingConfig,
  options: { createdById?: number | null; trx?: TransactionClientContract } = {}
): Promise<Quote> {
  const subtotal = roundCurrency(
    pricedLines.reduce((sum, line) => sum + line.result.calculation.finalPriceRounded, 0)
  )

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
        // Tax is a checkout concern; the column is NOT NULL so it is recorded
        // as zero here rather than calculated.
        tax: '0.00',
        total: subtotal.toFixed(2),
        status: 'draft',
        generatedBy: 'system',
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
        pricingConfigId: config.id,
        pricingSnapshot: result,
      }))
    )

    return quote
  }

  return options.trx ? run(options.trx) : db.transaction(run)
}
