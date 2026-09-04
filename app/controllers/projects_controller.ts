import string from '@adonisjs/core/helpers/string'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import Customer from '#models/customer'
import InstantQuoteFileTransformer from '#transformers/instant_quote_file_transformer'
import { captureProjectEmailValidator } from '#validators/project'
import { resolveProject } from '#services/project_grant_service'

export default class ProjectsController {
  /**
   * Attaches an email to an anonymous instant-quote project.
   *
   * This is the lead-capture moment - offered after the price is on screen,
   * framed as "email this quote to yourself". It is optional by design: the
   * project, its files and its quote all work without it.
   *
   * Creates a Customer with no user account (`user_id` stays null). Claiming a
   * real account later is just setting `user_id` on this same row.
   *
   * Note: this records the address, it does not send anything - there is no
   * mail infrastructure in the app yet.
   */
  async captureEmail(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const { email } = await request.validateUsing(captureProjectEmailValidator)

    const project = await resolveProject(ctx, params.projectUuid)
    if (!project) {
      return response.notFound({ error: 'Project not found' })
    }

    // An owned project keeps its owner - this must never reassign a project
    // away from the account or lead that already holds it.
    if (project.customerId) {
      return await serialize(InstantQuoteFileTransformer.transform(project))
    }

    const normalizedEmail = email.toLowerCase()
    const customer = await Customer.firstOrCreate(
      { email: normalizedEmail },
      { email: normalizedEmail, uuid: string.uuid() }
    )

    project.customerId = customer.id
    await project.save()

    logger.info(
      { projectUuid: project.uuid, customerUuid: customer.uuid },
      'Captured an email against an instant-quote project'
    )

    return await serialize(InstantQuoteFileTransformer.transform(project))
  }
}
