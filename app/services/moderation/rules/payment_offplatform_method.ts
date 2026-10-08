import { findInViews, OFF_PLATFORM_PAYMENT_METHODS } from '#services/moderation/lexicon'
import type { ModerationRule } from '#services/moderation/types'

/**
 * A payment method or rail named in the message. Weight only - MakeXYZ
 * checkout itself takes PayPal, so "I paid with PayPal" is normal. It adds to
 * the risk score and gives payment.direct_intent its payment term.
 */
const paymentOffplatformMethod: ModerationRule<{ weight: number }> = {
  id: 'payment.offplatform_method',
  version: 1,
  description: 'Mentions a payment method (weight only - never blocks on its own)',
  defaultMode: 'shadow',
  defaultConfig: { weight: 2 },
  evaluate(ctx, config) {
    const evidence = findInViews(ctx.views, OFF_PLATFORM_PAYMENT_METHODS, ['deobfuscated'])
    return evidence.length > 0
      ? {
          action: 'continue',
          reasonCode: 'payment.method_mentioned',
          weight: config.weight,
          evidence,
        }
      : null
  },
}

export default paymentOffplatformMethod
