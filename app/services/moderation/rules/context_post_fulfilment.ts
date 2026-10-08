import { findInViews } from '#services/moderation/lexicon'
import { promoEvidence } from '#services/moderation/rules/ad_promo_language'
import type { Evidence, ModerationRule } from '#services/moderation/types'

const FUTURE_WORK_PHRASES = [
  'next time',
  'future projects',
  'future orders',
  'future work',
  'order again',
  'come back to me',
  'repeat business',
  'my other services',
  'work together again',
  'another way we can work together',
] as const

/**
 * A vendor writing after delivery with a link, a promotion, or talk of
 * future work - the classic "for your next order, come to me directly"
 * moment. Escalates for a person (or the LLM) to judge.
 */
const contextPostFulfilment: ModerationRule = {
  id: 'context.post_fulfilment',
  version: 1,
  description: 'Vendor messages after delivery with links, promos or future-work talk',
  defaultMode: 'shadow',
  defaultConfig: {},
  senderRoles: ['vendor'],
  evaluate(ctx) {
    if (ctx.conversation.orderStatus !== 'delivered') {
      return null
    }
    const evidence: Evidence[] = [
      ...ctx.signals.urls.map((url) => ({ view: 'deobfuscated' as const, match: url.match })),
      ...promoEvidence(ctx),
      ...findInViews(ctx.views, FUTURE_WORK_PHRASES),
    ]
    return evidence.length > 0
      ? { action: 'escalate', reasonCode: 'context.post_fulfilment', evidence }
      : null
  },
}

export default contextPostFulfilment
