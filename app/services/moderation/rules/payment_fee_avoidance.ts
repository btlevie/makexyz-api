import { findInViews } from '#services/moderation/lexicon'
import type { ModerationRule } from '#services/moderation/types'

const FEE_AVOIDANCE_PHRASES = [
  'avoid fees',
  'avoid the fees',
  'avoid marketplace fees',
  'avoid platform fees',
  'avoid the commission',
  'save the commission',
  'save on fees',
  'skip the commission',
  'no commission',
  'cut out the middleman',
  'cut out the middle man',
  'bypass makexyz',
  'bypass the platform',
  'around makexyz',
] as const

/** Explicitly proposing to get around MakeXYZ's fees. */
const paymentFeeAvoidance: ModerationRule = {
  id: 'payment.fee_avoidance',
  version: 1,
  description: 'Proposals to avoid MakeXYZ fees or cut MakeXYZ out',
  defaultMode: 'shadow',
  defaultConfig: {},
  evaluate(ctx) {
    const evidence = findInViews(ctx.views, FEE_AVOIDANCE_PHRASES)
    return evidence.length > 0
      ? { action: 'review', reasonCode: 'payment.fee_avoidance', evidence }
      : null
  },
}

export default paymentFeeAvoidance
