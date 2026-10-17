import type { HttpContext } from '@adonisjs/core/http'
import ModerationTerm from '#models/moderation_term'
import ModerationTermTransformer from '#transformers/moderation_term_transformer'
import {
  addTermValidator,
  listTermsValidator,
  previewTermValidator,
  updateTermValidator,
} from '#validators/messaging'
import { isAdmin } from '#services/project_grant_service'
import {
  addTerm,
  InvalidTermError,
  listTerms,
  previewTerm,
  TermConflictError,
  updateTerm,
} from '#services/moderation_term_admin_service'

/**
 * The prohibited-item word lists at runtime: built-in terms plus admin
 * additions and overrides, each with its 30-day hit count. New slang holds
 * messages for review by default; an admin upgrades it to block once
 * confident, or disables a built-in that keeps misfiring. See
 * moderation_term_admin_service.ts.
 */
export default class AdminModerationTermsController {
  async index(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const filters = await request.validateUsing(listTermsValidator)
    const terms = await listTerms(filters)
    return await serialize(ModerationTermTransformer.transform(terms))
  }

  async store(ctx: HttpContext) {
    const { auth, request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const input = await request.validateUsing(addTermValidator)

    try {
      const row = await addTerm(input, auth.getUserOrFail())
      response.status(201)
      return await serialize(ModerationTermTransformer.transform(await this.viewOf(row)))
    } catch (error) {
      if (error instanceof TermConflictError) {
        return response.conflict({ error: error.message, uuid: error.existingUuid })
      }
      if (error instanceof InvalidTermError) {
        return response.unprocessableEntity({ error: error.message })
      }
      throw error
    }
  }

  async update(ctx: HttpContext) {
    const { auth, params, request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const changes = await request.validateUsing(updateTermValidator)

    const row = await ModerationTerm.findBy('uuid', params.uuid)
    if (!row) {
      return response.notFound({ error: 'Term not found' })
    }

    try {
      await updateTerm(row, changes, auth.getUserOrFail())
      return await serialize(ModerationTermTransformer.transform(await this.viewOf(row)))
    } catch (error) {
      if (error instanceof InvalidTermError) {
        return response.unprocessableEntity({ error: error.message })
      }
      throw error
    }
  }

  /** What a term would catch in recent messages - changes nothing. */
  async preview(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { category, term } = await request.validateUsing(previewTermValidator)

    try {
      return await serialize(await previewTerm(category, term))
    } catch (error) {
      if (error instanceof InvalidTermError) {
        return response.unprocessableEntity({ error: error.message })
      }
      throw error
    }
  }

  /** The listing entry for a row, so responses have the same shape as the index. */
  private async viewOf(row: ModerationTerm) {
    const views = await listTerms({ category: row.category, q: row.term })
    return views.find((view) => view.uuid === row.uuid)!
  }
}
