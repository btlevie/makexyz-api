import type { HttpContext } from '@adonisjs/core/http'
import Quote from '#models/quote'
import AdminQuoteReviewTransformer from '#transformers/admin_quote_review_transformer'
import QuoteTransformer from '#transformers/quote_transformer'
import { splitQuoteValidator } from '#validators/admin_quote'
import { isAdmin } from '#services/project_grant_service'
import { QuoteNotConfigurableError } from '#services/quote_generation_service'
import { splitQuote, InvalidSplitError } from '#services/quote_split_service'

export default class AdminQuotesController {
  /**
   * Quotes staff need to act on before a customer can proceed - each
   * lineage root currently flagged 'needs_review' (a reconfigured revision
   * inherits its root's already-resolved status, so only roots are listed).
   * Not QuoteTransformer's shape - admin needs each item's technology and
   * ProjectFile uuid to decide how to split, which the customer-facing
   * transformer doesn't expose.
   */
  async needsReview(ctx: HttpContext) {
    const { response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }

    const quotes = await Quote.query()
      .where('status', 'needs_review')
      .whereNull('originQuoteId')
      .preload('items', (q) => q.preload('projectFile'))
      .orderBy('createdAt', 'asc')

    return await serialize(AdminQuoteReviewTransformer.transform(quotes))
  }

  /**
   * Splits a 'needs_review' quote by dividing its items into groups (by
   * ProjectFile uuid) - see quote_split_service.ts.
   */
  async split(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }

    const { groups } = await request.validateUsing(splitQuoteValidator)

    const quote = await Quote.findBy('uuid', params.uuid)
    if (!quote) {
      return response.notFound({ error: 'Quote not found' })
    }

    try {
      const resulting = await splitQuote(
        quote,
        groups.map((group) => group.projectFileUuids),
        ctx.auth.getUserOrFail().id
      )
      return await serialize(QuoteTransformer.transform(resulting))
    } catch (error) {
      if (error instanceof InvalidSplitError) {
        return response.unprocessableEntity({ error: error.message })
      }
      if (error instanceof QuoteNotConfigurableError) {
        return response.conflict({ error: error.message })
      }
      throw error
    }
  }
}
