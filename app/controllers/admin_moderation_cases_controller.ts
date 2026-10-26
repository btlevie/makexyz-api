import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { loadReviewDetails } from '#services/message_review_details'
import Conversation from '#models/conversation'
import Customer from '#models/customer'
import ModerationCase from '#models/moderation_case'
import Vendor from '#models/vendor'
import ModerationCaseTransformer from '#transformers/moderation_case_transformer'
import {
  adminListCasesValidator,
  closeCaseConversationValidator,
  labelCaseValidator,
  resolveCaseValidator,
  restrictSubjectValidator,
  warnSubjectValidator,
} from '#validators/messaging'
import { isAdmin } from '#services/project_grant_service'
import { caseDetail } from '#services/case_detail_service'
import {
  approveCase,
  blockCase,
  CaseAlreadyResolvedError,
  CaseClaimedError,
  CaseHasNoConversationError,
  CaseHasNoSubjectError,
  claimCase,
  CLAIM_MINUTES,
  closeCaseConversation,
  labelCase,
  releaseCase,
  restrictCaseSubject,
  warnCaseSubject,
} from '#services/moderation_case_service'

const MAX_LISTED = 200

/** Errors every case action maps the same way. */
function conflictOrUnprocessable(error: unknown, response: HttpContext['response']) {
  if (error instanceof CaseAlreadyResolvedError || error instanceof CaseClaimedError) {
    return response.conflict({ error: error.message })
  }
  if (error instanceof CaseHasNoSubjectError || error instanceof CaseHasNoConversationError) {
    return response.unprocessableEntity({ error: error.message })
  }
  throw error
}

/**
 * The review queue (docs/plans/messaging_moderation.md, section 8), most
 * urgent first: held messages (someone is waiting), reports, flagged
 * messages, behavioral cases, audit samples. A moderator claims a case while
 * working it; the detail view has everything about it in one response; the
 * actions approve, block, restrict, warn, close the conversation and label -
 * each recorded in moderation_actions.
 */
export default class AdminModerationCasesController {
  async index(ctx: HttpContext) {
    const { auth, request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const filters = await request.validateUsing(adminListCasesValidator)
    const status = filters.status ?? 'active'
    const staleClaim = DateTime.now().minus({ minutes: CLAIM_MINUTES }).toSQL()!

    const customer = filters.customerUuid
      ? await Customer.findBy('uuid', filters.customerUuid)
      : null
    const vendor = filters.vendorUuid ? await Vendor.findBy('uuid', filters.vendorUuid) : null
    if ((filters.customerUuid && !customer) || (filters.vendorUuid && !vendor)) {
      return await serialize(ModerationCaseTransformer.transform([]))
    }

    const cases = await ModerationCase.query()
      .if(status === 'active', (query) => query.whereIn('status', ['open', 'claimed']))
      .if(status !== 'active', (query) => query.where('status', status))
      .if(filters.source, (query) => query.where('source', filters.source!))
      .if(filters.abuseCategory, (query) => query.where('abuseCategory', filters.abuseCategory!))
      .if(customer, (query) => query.where('customerId', customer!.id))
      .if(vendor, (query) => query.where('vendorId', vendor!.id))
      .if(filters.assigned === 'mine', (query) =>
        query
          .where('status', 'claimed')
          .where('assignedToId', auth.user!.id)
          .where('claimedAt', '>', staleClaim)
      )
      .if(filters.assigned === 'unassigned', (query) =>
        query.where((inner) =>
          inner
            .whereNot('status', 'claimed')
            .orWhereNull('claimedAt')
            .orWhere('claimedAt', '<=', staleClaim)
        )
      )
      .if(filters.ruleId, (query) =>
        query.whereIn('messageId', (sub) =>
          sub.from('moderation_rule_hits').where('rule_id', filters.ruleId!).select('message_id')
        )
      )
      .if(filters.senderRole, (query) =>
        query.whereIn('messageId', (sub) =>
          sub
            .from('messages')
            .whereNotNull(
              filters.senderRole === 'vendor' ? 'sender_vendor_id' : 'sender_customer_id'
            )
            .select('id')
        )
      )
      .orderBy('priority', 'asc')
      .orderBy('createdAt', 'asc')
      .limit(MAX_LISTED)
      .preload('message', (query) => query.preload('sender'))

    await this.attachContext(cases)
    return await serialize(ModerationCaseTransformer.transform(cases))
  }

  /** Everything about one case (case_detail_service.ts). */
  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const moderationCase = await ModerationCase.findBy('uuid', params.uuid)
    if (!moderationCase) {
      return response.notFound({ error: 'Case not found' })
    }
    return await serialize(await caseDetail(moderationCase))
  }

  async claim(ctx: HttpContext) {
    return this.simple(ctx, (moderationCase, moderator) => claimCase(moderationCase, moderator))
  }

  async release(ctx: HttpContext) {
    return this.simple(ctx, (moderationCase, moderator) => releaseCase(moderationCase, moderator))
  }

  async approve(ctx: HttpContext) {
    return this.resolve(ctx, approveCase)
  }

  async block(ctx: HttpContext) {
    return this.resolve(ctx, blockCase)
  }

  /** Labels a case (category, pattern note, missed by automation) - resolved or not. */
  async label(ctx: HttpContext) {
    const label = await ctx.request.validateUsing(labelCaseValidator)
    return this.simple(ctx, (moderationCase, moderator) =>
      labelCase(moderationCase, moderator, label)
    )
  }

  /** Emails the case subject a warning. Doesn't resolve the case. */
  async warn(ctx: HttpContext) {
    const { message } = await ctx.request.validateUsing(warnSubjectValidator)
    return this.simple(ctx, async (moderationCase, moderator) => {
      await warnCaseSubject(moderationCase, moderator, message)
      return moderationCase
    })
  }

  /** Closes the case's conversation early (read-only, noted in the thread). */
  async closeConversation(ctx: HttpContext) {
    const { note } = await ctx.request.validateUsing(closeCaseConversationValidator)
    return this.simple(ctx, async (moderationCase, moderator) => {
      await closeCaseConversation(moderationCase, moderator, note)
      return moderationCase
    })
  }

  /**
   * Restricts or suspends the case subject's messaging (or lifts it with
   * tier 'standard'), optionally for `days`. Messaging only. Leaves the case
   * open so its message can still be approved or blocked.
   */
  async restrict(ctx: HttpContext) {
    const { auth, params, request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { tier, days, note } = await request.validateUsing(restrictSubjectValidator)

    const moderationCase = await ModerationCase.findBy('uuid', params.uuid)
    if (!moderationCase) {
      return response.notFound({ error: 'Case not found' })
    }

    try {
      const profile = await restrictCaseSubject(moderationCase, auth.getUserOrFail(), {
        tier,
        days,
        note,
      })
      return await serialize({
        trustTier: profile.trustTier,
        restrictionExpiresAt: profile.restrictionExpiresAt,
      })
    } catch (error) {
      return conflictOrUnprocessable(error, response)
    }
  }

  private async resolve(ctx: HttpContext, action: typeof approveCase) {
    const { request } = ctx
    const { note, ...label } = await request.validateUsing(resolveCaseValidator)
    return this.simple(ctx, (moderationCase, moderator) =>
      action(moderationCase, moderator, note, label)
    )
  }

  /** Finds the case, runs the action, maps errors, returns the case as the queue shows it. */
  private async simple(
    ctx: HttpContext,
    action: (
      moderationCase: ModerationCase,
      moderator: ReturnType<HttpContext['auth']['getUserOrFail']>
    ) => Promise<ModerationCase>
  ) {
    const { auth, params, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const moderationCase = await ModerationCase.findBy('uuid', params.uuid)
    if (!moderationCase) {
      return response.notFound({ error: 'Case not found' })
    }

    try {
      await action(moderationCase, auth.getUserOrFail())
    } catch (error) {
      return conflictOrUnprocessable(error, response)
    }

    await moderationCase.load('message', (query) => query.preload('sender'))
    await this.attachContext([moderationCase])
    return await serialize(ModerationCaseTransformer.transform(moderationCase))
  }

  /**
   * The conversation uuid and each message's rule hits, links (with their
   * reputation) and attachments, for the moderator's view.
   */
  private async attachContext(cases: ModerationCase[]) {
    const messages = cases.map((moderationCase) => moderationCase.message).filter(Boolean)
    if (messages.length === 0) {
      return
    }
    const conversations = await Conversation.query().whereIn(
      'id',
      messages.map((message) => message.conversationId)
    )
    await loadReviewDetails(messages)
    for (const moderationCase of cases) {
      const message = moderationCase.message
      if (!message) continue
      moderationCase.$extras.conversationUuid =
        conversations.find((conversation) => conversation.id === message.conversationId)?.uuid ??
        null
    }
  }
}
