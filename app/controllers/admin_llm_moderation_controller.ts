import type { HttpContext } from '@adonisjs/core/http'
import { llmStatsValidator } from '#validators/messaging'
import { isAdmin } from '#services/project_grant_service'
import { llmMode, llmStats } from '#services/llm_moderation_service'

/**
 * LLM-assisted moderation at a glance: the mode in force, calls, failures,
 * outcomes, tokens and estimated cost, and how often the LLM's outcome
 * matched a moderator's decision - the evidence for moving from shadow to
 * enforce (llm_moderation_service.ts).
 */
export default class AdminLlmModerationController {
  async stats(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { days } = await request.validateUsing(llmStatsValidator)
    return await serialize({ mode: llmMode(), ...(await llmStats(days ?? 7)) })
  }
}
