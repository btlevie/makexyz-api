import type { HttpContext } from '@adonisjs/core/http'
import UrlDomainTransformer from '#transformers/url_domain_transformer'
import { listDomainsValidator, updateDomainValidator } from '#validators/messaging'
import { isAdmin } from '#services/project_grant_service'
import { InvalidDomainError, listDomains, setDomainList } from '#services/url_domain_admin_service'

/**
 * The link domain lists at runtime: allow (lifts the unknown-link hold),
 * block (always blocked) and user content (file hosting - always checked
 * per URL), as built-ins plus admin overrides, with how widely each domain
 * has been seen. See url_domain_admin_service.ts.
 */
export default class AdminUrlDomainsController {
  async index(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const filters = await request.validateUsing(listDomainsValidator)
    return await serialize(UrlDomainTransformer.transform(await listDomains(filters)))
  }

  /** PUT - sets the override for :domain, or clears it with `listStatus: null`. */
  async update(ctx: HttpContext) {
    const { auth, params, request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { listStatus, note } = await request.validateUsing(updateDomainValidator)

    try {
      const view = await setDomainList(
        { domain: params.domain, listStatus, note },
        auth.getUserOrFail()
      )
      return await serialize(UrlDomainTransformer.transform(view))
    } catch (error) {
      if (error instanceof InvalidDomainError) {
        return response.unprocessableEntity({ error: error.message })
      }
      throw error
    }
  }
}
