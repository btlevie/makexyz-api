import { findInViews, WORK_CONTEXT_TERMS } from '#services/moderation/lexicon'
import { promoEvidence } from '#services/moderation/rules/ad_promo_language'
import type { ModerationRule } from '#services/moderation/types'

/**
 * The same text blasted around: this sender sent it to other conversations
 * in the last 24 hours, or other senders sent the identical text.
 *
 * Exception: a customer sending the same request for quotes to several
 * vendors is normal comparison shopping. A duplicated inquiry opener only
 * counts when it also has a link, promotional language, or nothing about
 * actual work.
 */
const spamDuplicateCrossConversation: ModerationRule<{
  otherConversations: number
  otherSenders: number
}> = {
  id: 'spam.duplicate_cross_conversation',
  version: 1,
  description: 'Identical text sent to several conversations, or by several senders',
  defaultMode: 'shadow',
  defaultConfig: { otherConversations: 2, otherSenders: 2 },
  evaluate(ctx, config) {
    const { history } = ctx
    const fanout = history.sameTextOtherConversations >= config.otherConversations
    const crowd = history.sameTextOtherSenders >= config.otherSenders
    if (!fanout && !crowd) {
      return null
    }

    const isRfq = ctx.senderRole === 'customer' && ctx.conversation.isFirstMessage
    if (isRfq && !crowd) {
      const looksLikeWork = findInViews(ctx.views, WORK_CONTEXT_TERMS, ['deobfuscated']).length > 0
      const suspicious =
        ctx.signals.urls.length > 0 || promoEvidence(ctx).length > 0 || !looksLikeWork
      if (!suspicious) {
        return null
      }
    }

    return {
      action: 'review',
      reasonCode: 'spam.duplicate',
      evidence: [
        {
          view: 'normalized',
          match: `same text in ${history.sameTextOtherConversations} other conversation(s), from ${history.sameTextOtherSenders} other sender(s)`,
        },
      ],
    }
  },
}

export default spamDuplicateCrossConversation
