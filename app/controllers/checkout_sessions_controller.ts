import type { HttpContext } from '@adonisjs/core/http'
import Order from '#models/order'
import Project from '#models/project'
import Quote from '#models/quote'
import OrderTransformer from '#transformers/order_transformer'
import { payValidator } from '#validators/checkout'
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
   * One-call checkout for an accepted quote: finds or opens its checkout
   * session, authorizes payment (a hold, never a charge) and creates the
   * Order, all in a single request. The session still
   * exists underneath (its expiry drives the hold release, and a declined
   * attempt fails it so the next call opens a fresh one); the frontend just
   * never has to handle it. Public: instant-quote customers are anonymous
   * and authorize with their project grant, same as the rest of this flow.
   *
   * Idempotent per quote: once an order exists for the quote it is returned
   * as-is, so a retry can never authorize the card a second time - even after
   * capture has completed the original session.
   */
  async pay(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const { provider, providerToken, email } = await request.validateUsing(payValidator)

    const project = (await isStaff(ctx))
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

    const existingOrder = await Order.findBy('quoteId', quote.id)
    if (existingOrder) {
      return await serialize(OrderTransformer.transform(await this.loadForResponse(existingOrder)))
    }

    // Only a quote staff configured on a guest's behalf can still lack a
    // customer here - configure requires a guest's email.
    if (!project.customerId) {
      if (!email) {
        return response.unprocessableEntity({
          error:
            'An email address is required to check out (no account or lead-capture email on file yet)',
        })
      }
      await attachLeadCustomer(project, email)
    }

    try {
      const checkoutSession = await createCheckoutSession(project.id, quote, project.customerId)
      const { order } = await authorizeCheckoutSession(
        checkoutSession,
        quote,
        provider,
        providerToken
      )
      return await serialize(OrderTransformer.transform(await this.loadForResponse(order)))
    } catch (error) {
      if (
        error instanceof QuoteNotAcceptedError ||
        error instanceof PaymentAuthorizationFailedError
      ) {
        return response.unprocessableEntity({ error: error.message })
      }
      if (error instanceof CheckoutSessionNotActiveError) {
        return response.conflict({ error: error.message })
      }
      throw error
    }
  }

  private async loadForResponse(order: Order): Promise<Order> {
    await order.load('items')
    await order.load('address')
    return order
  }
}
