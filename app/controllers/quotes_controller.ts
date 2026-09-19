import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import Address from '#models/address'
import Customer from '#models/customer'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import QuoteTransformer from '#transformers/quote_transformer'
import { configureQuoteValidator, createQuoteValidator } from '#validators/quote'
import type { FdmPricingResult } from '#services/fdm_pricing_calculator'
import { getActiveFdmConfig, PricingConfigurationError } from '#services/pricing_config_service'
import {
  configureQuote,
  persistQuote,
  priceLine,
  ProductionTimeInfeasibleError,
  QuoteNotConfigurableError,
  UnpriceableLineError,
  type QuoteAddressInput,
  type ResolvedPricingConfigs,
} from '#services/quote_generation_service'
import { InvalidShippingSelectionError } from '#services/shipping_service'
import { InvalidProductionTimeSelectionError } from '#services/production_time_service'
import { isServiceableCountry } from '#services/serviceable_country_service'
import { isStaff, resolveProject } from '#services/project_grant_service'

export default class QuotesController {
  /**
   * Prices every requested project file and persists the result as a new quote
   * revision.
   *
   * Manufacturing price only - shipping, tax, fees and any cart minimum are
   * checkout concerns and deliberately absent here.
   *
   * Delegates the actual pricing/persistence to quote_generation_service, the
   * same functions the slicer-callback auto-quote path uses, so the two can
   * never price a file differently.
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
    let configs: ResolvedPricingConfigs
    try {
      configs = { fdm: await getActiveFdmConfig() }
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

      try {
        const result = priceLine(project, { projectFile, quantity: item.quantity }, configs)
        pricedLines.push({ projectFile, result })
      } catch (error) {
        if (error instanceof UnpriceableLineError) {
          logger.warn(
            { projectFileUuid: projectFile.uuid, error: error.message },
            'Refused to price a project file'
          )
          return response.unprocessableEntity({ error: error.message })
        }
        throw error
      }
    }

    const quote = await persistQuote(project, pricedLines, { createdById: user.id })
    await quote.load('items')
    await quote.load('address')

    return await serialize(QuoteTransformer.transform(quote))
  }

  /**
   * Sets/updates shipping, production time, tax, and shipping address on a
   * quote before the customer accepts it. Public: instant-quote customers
   * are anonymous and authorize with their project grant, same as the rest
   * of this flow.
   */
  async configure(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const {
      destinationCountry,
      shippingMethod,
      productionTimeBusinessDays,
      addressUuid,
      shippingAddressLabel,
      shippingRecipientName,
      shippingLine1,
      shippingLine2,
      shippingCity,
      shippingState,
      shippingPostalCode,
    } = await request.validateUsing(configureQuoteValidator)

    const project = isStaff(ctx)
      ? await Project.findBy('uuid', params.projectUuid)
      : await resolveProject(ctx, params.projectUuid)
    if (!project) {
      return response.notFound({ error: 'Project not found' })
    }

    if (!(await isServiceableCountry(destinationCountry))) {
      return response.unprocessableEntity({
        error: `We don't currently ship to "${destinationCountry}"`,
      })
    }

    // Either an existing saved address (scoped to this project's own
    // customer - never another customer's, and never matched at all for an
    // anonymous project with no customer yet) or inline fields to create a
    // new one.
    let address: QuoteAddressInput
    if (addressUuid) {
      const existing = await Address.query()
        .where('uuid', addressUuid)
        .where('ownerType', 'customer')
        .where('customerId', project.customerId ?? -1)
        .first()
      if (!existing) {
        return response.unprocessableEntity({ error: `Address ${addressUuid} not found` })
      }
      address = {
        mode: 'existing',
        addressId: existing.id,
        line1: existing.line1,
        line2: existing.line2,
        city: existing.city,
        state: existing.state,
        postalCode: existing.postalCode,
      }
    } else {
      if (!shippingRecipientName || !shippingLine1 || !shippingCity || !shippingPostalCode) {
        return response.unprocessableEntity({
          error: 'A shipping address (or a saved addressUuid) is required',
        })
      }
      address = {
        mode: 'new',
        recipientName: shippingRecipientName,
        line1: shippingLine1,
        line2: shippingLine2,
        city: shippingCity,
        state: shippingState,
        postalCode: shippingPostalCode,
        label: shippingAddressLabel,
      }
    }

    const latestQuote = await Quote.query()
      .where('uuid', params.uuid)
      .where('projectId', project.id)
      .first()
    if (!latestQuote) {
      return response.notFound({ error: 'Quote not found' })
    }

    try {
      const configured = await configureQuote(project, latestQuote, {
        destinationCountry,
        shippingMethod,
        productionTimeBusinessDays,
        address,
      })
      await configured.load('items')
      await configured.load('address')
      return await serialize(QuoteTransformer.transform(configured))
    } catch (error) {
      if (error instanceof QuoteNotConfigurableError) {
        return response.conflict({ error: error.message })
      }
      if (
        error instanceof ProductionTimeInfeasibleError ||
        error instanceof InvalidShippingSelectionError ||
        error instanceof InvalidProductionTimeSelectionError
      ) {
        return response.unprocessableEntity({ error: error.message })
      }
      if (error instanceof PricingConfigurationError) {
        logger.error(
          { projectUuid: project.uuid, error: error.message },
          'Production-time configuration unavailable'
        )
        return response.serviceUnavailable({
          error: 'Pricing is unavailable because no valid configuration is active',
        })
      }
      throw error
    }
  }

  /**
   * Freezes a fully-configured quote so checkout can authorize payment
   * against it. Public, same access as configure above.
   */
  async accept(ctx: HttpContext) {
    const { params, response, serialize } = ctx

    const project = isStaff(ctx)
      ? await Project.findBy('uuid', params.projectUuid)
      : await resolveProject(ctx, params.projectUuid)
    if (!project) {
      return response.notFound({ error: 'Project not found' })
    }

    const quote = await Quote.query()
      .where('uuid', params.uuid)
      .where('projectId', project.id)
      .first()
    if (!quote) {
      return response.notFound({ error: 'Quote not found' })
    }

    if (quote.status === 'accepted') {
      // Idempotent - re-accepting an already-accepted quote is a no-op, not
      // an error.
      await quote.load('items')
      await quote.load('address')
      return await serialize(QuoteTransformer.transform(quote))
    }
    if (quote.status === 'rejected') {
      return response.conflict({ error: `Quote ${quote.uuid} was rejected and cannot be accepted` })
    }
    if (
      !quote.destinationCountry ||
      !quote.shippingMethod ||
      quote.productionTimeBusinessDays === null ||
      !quote.addressId
    ) {
      return response.unprocessableEntity({
        error:
          'Quote must be configured (destination, shipping, production time, and shipping address) before it can be accepted',
      })
    }

    const latest = await Quote.query()
      .where('projectId', project.id)
      .orderBy('revision', 'desc')
      .firstOrFail()
    if (latest.id !== quote.id) {
      return response.conflict({
        error: `Quote ${quote.uuid} (revision ${quote.revision}) is no longer the latest revision for this project`,
      })
    }

    quote.status = 'accepted'
    await quote.save()
    await quote.load('items')
    await quote.load('address')

    return await serialize(QuoteTransformer.transform(quote))
  }
}
