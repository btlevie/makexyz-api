import { findInViews, WORK_CONTEXT_TERMS } from '#services/moderation/lexicon'
import { promoEvidence } from '#services/moderation/rules/ad_promo_language'
import type { ModerationRule } from '#services/moderation/types'

/**
 * The same pitch sent to several conversations with small edits, so the
 * exact-duplicate rule misses it (near_duplicate.ts, last 7 days). Same
 * exception as spam.duplicate_cross_conversation: a customer sending one
 * request for quotes to several vendors is comparison shopping unless it
 * also has a link, promotional language, or nothing about actual work.
 */
const spamNearDuplicate: ModerationRule<{ otherConversations: number }> = {
  id: 'spam.near_duplicate',
  version: 1,
  description: 'Nearly identical text sent to several conversations',
  defaultMode: 'shadow',
  defaultConfig: { otherConversations: 3 },
  evaluate(ctx, config) {
    const count = ctx.history.nearDuplicateOtherConversations
    if (count < config.otherConversations) {
      return null
    }
    if (ctx.senderRole === 'customer' && ctx.conversation.isFirstMessage) {
      const looksLikeWork = findInViews(ctx.views, WORK_CONTEXT_TERMS, ['deobfuscated']).length > 0
      const suspicious =
        ctx.signals.urls.length > 0 || promoEvidence(ctx).length > 0 || !looksLikeWork
      if (!suspicious) {
        return null
      }
    }
    return {
      action: 'review',
      reasonCode: 'spam.near_duplicate',
      evidence: [
        { view: 'normalized', match: `nearly the same text in ${count} other conversation(s)` },
      ],
    }
  },
}

export default spamNearDuplicate
