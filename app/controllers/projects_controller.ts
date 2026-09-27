import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import InstantQuoteFileTransformer from '#transformers/instant_quote_file_transformer'
import { captureProjectEmailValidator } from '#validators/project'
import { resolveProject } from '#services/project_grant_service'
import { attachLeadCustomer } from '#services/lead_customer_service'

export default class ProjectsController {
  /**
   * Attaches an email to an anonymous instant-quote project.
   *
   * This is "email this quote to yourself" - offered after the price is on
   * screen, optional by design: the project, its files and its quote all work
   * without it. (Configure separately requires an email alongside the
   * shipping address, so a guest who checks out always has one.) Can also
   * record the guest's marketing opt-in choice.
   *
   * Creates a Customer with no user account (`user_id` stays null) - see
   * lead_customer_service.ts.
   *
   * Note: this records the address, it does not send anything - there is no
   * mail infrastructure in the app yet.
   */
  async captureEmail(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const { email, marketingOptIn } = await request.validateUsing(captureProjectEmailValidator)

    const project = await resolveProject(ctx, params.projectUuid)
    if (!project) {
      return response.notFound({ error: 'Project not found' })
    }

    const wasOwned = project.customerId !== null
    const customer = await attachLeadCustomer(project, email, marketingOptIn)

    if (!wasOwned && customer) {
      logger.info(
        { projectUuid: project.uuid, customerUuid: customer.uuid },
        'Captured an email against an instant-quote project'
      )
    }

    return await serialize(InstantQuoteFileTransformer.transform(project))
  }
}
