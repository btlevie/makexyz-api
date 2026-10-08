import { findInViews, WORK_CONTEXT_TERMS } from '#services/moderation/lexicon'
import { promoEvidence } from '#services/moderation/rules/ad_promo_language'
import type { ModerationRule } from '#services/moderation/types'

/**
 * Promotional language with nothing about the work in hand - advertising an
 * unrelated product or service. Escalates (the LLM, once it exists, decides).
 */
const contextOffTopicCommercial: ModerationRule = {
  id: 'context.off_topic_commercial',
  version: 1,
  description: 'Promotional messages with no manufacturing/order context',
  defaultMode: 'shadow',
  defaultConfig: {},
  evaluate(ctx) {
    const promo = promoEvidence(ctx)
    if (promo.length === 0) {
      return null
    }
    const onTopic = findInViews(ctx.views, WORK_CONTEXT_TERMS, ['deobfuscated']).length > 0
    return onTopic
      ? null
      : { action: 'escalate', reasonCode: 'context.off_topic_commercial', evidence: promo }
  },
}

export default contextOffTopicCommercial
