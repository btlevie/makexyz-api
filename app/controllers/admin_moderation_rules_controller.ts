import type { HttpContext } from '@adonisjs/core/http'
import ModerationRuleTransformer from '#transformers/moderation_rule_transformer'
import { updateRuleValidator } from '#validators/messaging'
import { isAdmin } from '#services/project_grant_service'
import {
  findRule,
  InvalidRuleConfigError,
  listRules,
  updateRule,
} from '#services/moderation_rule_admin_service'

/**
 * Moderation rules at runtime: every rule with its effective mode
 * (off/shadow/enforce) and config, and changing them - e.g. promoting a rule
 * from shadow to enforce once its hits look precise. See
 * moderation_rule_admin_service.ts.
 */
export default class AdminModerationRulesController {
  async index(ctx: HttpContext) {
    const { response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const rules = await listRules()
    return await serialize(ModerationRuleTransformer.transform(rules))
  }

  async update(ctx: HttpContext) {
    const { auth, params, request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { mode, config, reason } = await request.validateUsing(updateRuleValidator)

    const rule = findRule(params.ruleId)
    if (!rule) {
      return response.notFound({ error: 'Rule not found' })
    }

    try {
      const updated = await updateRule(rule, { mode, config }, auth.getUserOrFail(), reason)
      return await serialize(ModerationRuleTransformer.transform(updated))
    } catch (error) {
      if (error instanceof InvalidRuleConfigError) {
        return response.unprocessableEntity({ error: error.message })
      }
      throw error
    }
  }
}
