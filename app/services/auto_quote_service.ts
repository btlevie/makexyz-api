/**
 * Automatic instant quoting.
 *
 * The product promise is upload -> price with no account and no extra step, but
 * a quote cannot be built at upload time: pricing needs grams and print time,
 * which only arrive on the slicer callback. So quoting is triggered from that
 * callback instead, once every file on the project has finished slicing.
 */
import logger from '@adonisjs/core/services/logger'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import { getActiveFdmConfig, PricingConfigurationError } from '#services/pricing_config_service'
import {
  persistQuote,
  priceLine,
  UnpriceableLineError,
  type QuoteLineRequest,
} from '#services/quote_generation_service'
import type { FdmPricingResult } from '#services/fdm_pricing_calculator'

/** Files in these states are still working; the project isn't ready to price. */
const IN_FLIGHT_STATUSES = ['pending', 'processing']

/** One of each part unless the customer says otherwise. */
const DEFAULT_QUANTITY = 1

/**
 * Quotes a project if all of its files are done slicing, otherwise does nothing.
 *
 * Never throws: this runs inside the slicer callback, and failing to price must
 * not fail the callback and send the slicing job back for a retry it can't fix.
 */
export async function autoQuoteProjectIfReady(projectId: number | null): Promise<void> {
  if (!projectId) {
    return
  }

  try {
    const project = await Project.find(projectId)
    if (!project) {
      return
    }

    const projectFiles = await ProjectFile.query()
      .where('projectId', project.id)
      .preload('material')
      .preload('sliceVariants')

    if (projectFiles.some((file) => IN_FLIGHT_STATUSES.includes(file.status))) {
      return
    }

    // A single unsliceable file must not cost the customer their whole price -
    // quote what did succeed and leave the failures to be reported separately.
    const completed = projectFiles.filter((file) => file.status === 'completed')
    if (completed.length === 0) {
      logger.warn(
        { projectUuid: project.uuid, fileCount: projectFiles.length },
        'Every file failed slicing; nothing to quote'
      )
      return
    }

    const configs = { fdm: await getActiveFdmConfig() }

    const pricedLines: { projectFile: ProjectFile; result: FdmPricingResult }[] = []
    for (const projectFile of completed) {
      const line: QuoteLineRequest = { projectFile, quantity: DEFAULT_QUANTITY }
      try {
        pricedLines.push({ projectFile, result: priceLine(project, line, configs) })
      } catch (error) {
        if (error instanceof UnpriceableLineError) {
          // e.g. an SLA file, which has no material and no SLA pricing config yet.
          logger.warn(
            { projectUuid: project.uuid, projectFileUuid: projectFile.uuid, error: error.message },
            'Skipped a file while auto-quoting'
          )
          continue
        }
        throw error
      }
    }

    if (pricedLines.length === 0) {
      return
    }

    const quote = await persistQuote(project, pricedLines)

    logger.info(
      {
        projectUuid: project.uuid,
        quoteUuid: quote.uuid,
        revision: quote.revision,
        lineCount: pricedLines.length,
        skipped: projectFiles.length - pricedLines.length,
      },
      'Auto-generated an instant quote'
    )
  } catch (error) {
    if (error instanceof PricingConfigurationError) {
      logger.error({ projectId, error: error.message }, 'Cannot auto-quote: pricing unavailable')
      return
    }
    logger.error({ projectId, error: String(error) }, 'Auto-quoting failed')
  }
}
