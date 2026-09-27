import type { HttpContext } from '@adonisjs/core/http'
import CheckoutSession from '#models/checkout_session'
import Project from '#models/project'
import Quote from '#models/quote'
import CheckoutSessionTransformer from '#transformers/checkout_session_transformer'
import OrderTransformer from '#transformers/order_transformer'
import {
  authorizeCheckoutSessionValidator,
  createCheckoutSessionValidator,
} from '#validators/checkout'
import { isStaff, resolveProject } from '#services/project_grant_service'
import { attachLeadCustomer } from '#services/lead_customer_service'
import {
  authorizeCheckoutSession,
  createCheckoutSession,
  CheckoutSessionNotActiveError,
  PaymentAuthorizationFailedError,
  QuoteNotAcceptedError,
} from '#services/checkout_service'

export default class CheckoutSessionsController {
  /**
   * Creates (or returns the existing active one for) a checkout session
   * against an accepted quote. Public: instant-quote customers are anonymous
   * and authorize with their project grant, same as the rest of this flow.
   *
   * If the project has no Customer attached yet, attaches one from `email`
   * the same way configure and lead-capture do. A guest always has one by now
   * (configure requires an email), so this only matters for a quote staff
   * configured on a guest's behalf - forcing an account here would break the
   * no-account-needed guest flow this system is built on.
   */
  async store(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const { email } = await request.validateUsing(createCheckoutSessionValidator)

    const project = (await isStaff(ctx))
      ? await Project.findBy('uuid', params.projectUuid)
      : await resolveProject(ctx, params.projectUuid)
    if (!project) {
      return response.notFound({ error: 'Project not found' })
    }

    if (!project.customerId) {
      if (!email) {
        return response.unprocessableEntity({
          error:
            'An email address is required to check out (no account or lead-capture email on file yet)',
        })
      }
      await attachLeadCustomer(project, email)
    }

    const quote = await Quote.query()
      .where('uuid', params.uuid)
      .where('projectId', project.id)
      .first()
    if (!quote) {
      return response.notFound({ error: 'Quote not found' })
    }

    try {
      const checkoutSession = await createCheckoutSession(project.id, quote, project.customerId)
      return await serialize(CheckoutSessionTransformer.transform(checkoutSession))
    } catch (error) {
      if (error instanceof QuoteNotAcceptedError) {
        return response.unprocessableEntity({ error: error.message })
      }
      throw error
    }
  }

  /**
   * Authorizes payment (a hold, never a charge) against the checkout
   * session's quote and creates the resulting Order. Public, same access as
   * store above.
   */
  async authorize(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const { provider, providerToken } = await request.validateUsing(
      authorizeCheckoutSessionValidator
    )

    const project = (await isStaff(ctx))
      ? await Project.findBy('uuid', params.projectUuid)
      : await resolveProject(ctx, params.projectUuid)
    if (!project) {
      return response.notFound({ error: 'Project not found' })
    }

    const checkoutSession = await CheckoutSession.query()
      .where('uuid', params.uuid)
      .where('projectId', project.id)
      .first()
    if (!checkoutSession) {
      return response.notFound({ error: 'Checkout session not found' })
    }

    const quote = await Quote.findOrFail(checkoutSession.quoteId!)

    try {
      const { order } = await authorizeCheckoutSession(
        checkoutSession,
        quote,
        provider,
        providerToken
      )
      await order.load('items')
      await order.load('address')
      return await serialize(OrderTransformer.transform(order))
    } catch (error) {
      if (error instanceof CheckoutSessionNotActiveError) {
        return response.conflict({ error: error.message })
      }
      if (error instanceof PaymentAuthorizationFailedError) {
        return response.unprocessableEntity({ error: error.message })
      }
      throw error
    }
  }
}
