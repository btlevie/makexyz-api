import type { HttpContext } from '@adonisjs/core/http'
import Conversation from '#models/conversation'
import ModerationCase from '#models/moderation_case'
import ModerationRuleHit from '#models/moderation_rule_hit'
import ModerationCaseTransformer from '#transformers/moderation_case_transformer'
import { adminListCasesValidator, resolveCaseValidator } from '#validators/messaging'
import { isAdmin } from '#services/project_grant_service'
import { approveCase, blockCase, CaseAlreadyResolvedError } from '#services/moderation_case_service'

const MAX_LISTED = 200

/**
 * The review queue - held messages first (someone is waiting), then flagged
 * ones and vendor reports. Step 1 of docs/plans/messaging_moderation.md:
 * approve or block; claiming, labels and user sanctions come later.
 */
export default class AdminModerationCasesController {
  async index(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { status } = await request.validateUsing(adminListCasesValidator)

    const cases = await ModerationCase.query()
      .where('status', status ?? 'open')
      .orderBy('priority', 'asc')
      .orderBy('createdAt', 'asc')
      .limit(MAX_LISTED)
      .preload('message', (query) => query.preload('sender'))

    await this.attachContext(cases)
    return await serialize(ModerationCaseTransformer.transform(cases))
  }

  async approve(ctx: HttpContext) {
    return this.resolve(ctx, approveCase)
  }

  async block(ctx: HttpContext) {
    return this.resolve(ctx, blockCase)
  }

  private async resolve(ctx: HttpContext, action: typeof approveCase) {
    const { auth, params, request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { note } = await request.validateUsing(resolveCaseValidator)

    const moderationCase = await ModerationCase.findBy('uuid', params.uuid)
    if (!moderationCase) {
      return response.notFound({ error: 'Case not found' })
    }

    try {
      await action(moderationCase, auth.getUserOrFail(), note)
    } catch (error) {
      if (error instanceof CaseAlreadyResolvedError) {
        return response.conflict({ error: error.message })
      }
      throw error
    }

    await moderationCase.load('message', (query) => query.preload('sender'))
    await this.attachContext([moderationCase])
    return await serialize(ModerationCaseTransformer.transform(moderationCase))
  }

  /** The conversation uuid and each message's rule hits, for the moderator's view. */
  private async attachContext(cases: ModerationCase[]) {
    const messages = cases.map((moderationCase) => moderationCase.message).filter(Boolean)
    if (messages.length === 0) {
      return
    }
    const conversations = await Conversation.query().whereIn(
      'id',
      messages.map((message) => message.conversationId)
    )
    const hits = await ModerationRuleHit.query().whereIn(
      'messageId',
      messages.map((message) => message.id)
    )
    for (const moderationCase of cases) {
      const message = moderationCase.message
      if (!message) continue
      moderationCase.$extras.conversationUuid =
        conversations.find((conversation) => conversation.id === message.conversationId)?.uuid ??
        null
      message.$extras.ruleHits = hits
        .filter((hit) => hit.messageId === message.id)
        .map((hit) => ({
          ruleId: hit.ruleId,
          ruleVersion: hit.ruleVersion,
          action: hit.action,
          shadow: hit.shadow,
          evidence: hit.evidence,
        }))
    }
  }
}
