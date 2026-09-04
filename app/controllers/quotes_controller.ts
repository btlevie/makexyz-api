import string from '@adonisjs/core/helpers/string'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import Customer from '#models/customer'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import QuoteTransformer from '#transformers/quote_transformer'
import { createQuoteValidator } from '#validators/quote'
import {
  calculateFdmPrice,
  roundCurrency,
  InvalidPricingInputError,
  type FdmPricingResult,
} from '#services/fdm_pricing_calculator'
import { getActiveFdmConfig, PricingConfigurationError } from '#services/pricing_config_service'
import { buildFdmPricingInputs } from '#services/project_file_pricing_inputs'

export default class QuotesController {
  /**
   * Prices every requested project file and persists the result as a new quote
   * revision.
   *
   * Manufacturing price only - shipping, tax, fees and any cart minimum are
   * checkout concerns and deliberately absent here.
   */
  async store({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { items } = await request.validateUsing(createQuoteValidator)

    const customer = await Customer.findBy('userId', user.id)
    const project = customer
      ? await Project.query()
          .where('uuid', params.projectUuid)
          .where('customerId', customer.id)
          .first()
      : null

    // 404 rather than 403 for a project owned by someone else - no reason to
    // confirm it exists.
    if (!project) {
      return response.notFound({ error: 'Project not found' })
    }

    // One configuration snapshot for the whole quote: every line must be priced
    // against the same version, even if an admin activates a new one mid-request.
    let config
    try {
      config = await getActiveFdmConfig()
    } catch (error) {
      if (error instanceof PricingConfigurationError) {
        logger.error(
          { projectUuid: project.uuid, error: error.message },
          'Pricing configuration unavailable'
        )
        return response.serviceUnavailable({
          error: 'Pricing is unavailable because no valid pricing configuration is active',
        })
      }
      throw error
    }

    const pricedLines: { projectFile: ProjectFile; result: FdmPricingResult }[] = []

    for (const item of items) {
      const projectFile = await ProjectFile.query()
        .where('uuid', item.projectFileUuid)
        .where('projectId', project.id)
        .preload('material')
        .preload('sliceVariants')
        .first()

      if (!projectFile) {
        return response.notFound({
          error: `Project file ${item.projectFileUuid} not found on this project`,
        })
      }

      if (!projectFile.material) {
        return response.unprocessableEntity({
          error: `Project file ${projectFile.uuid} has no material assigned`,
        })
      }

      try {
        const inputs = buildFdmPricingInputs(projectFile, projectFile.material, item.quantity)
        const result = calculateFdmPrice(inputs, config)

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

        pricedLines.push({ projectFile, result })
      } catch (error) {
        if (error instanceof InvalidPricingInputError) {
          logger.warn(
            { projectFileUuid: projectFile.uuid, error: error.message },
            'Refused to price a project file'
          )
          return response.unprocessableEntity({ error: error.message })
        }
        throw error
      }
    }

    const subtotal = roundCurrency(
      pricedLines.reduce((sum, line) => sum + line.result.calculation.finalPriceRounded, 0)
    )

    const quote = await db.transaction(async (trx) => {
      const latest = await Quote.query({ client: trx })
        .where('projectId', project.id)
        .orderBy('revision', 'desc')
        .first()

      const created = await Quote.create(
        {
          uuid: string.uuid(),
          projectId: project.id,
          createdById: user.id,
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

      await created.related('items').createMany(
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

      return created
    })

    await quote.load('items')

    return await serialize(QuoteTransformer.transform(quote))
  }
}
