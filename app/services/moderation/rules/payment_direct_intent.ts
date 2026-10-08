import { findInViews, OFF_PLATFORM_PAYMENT_METHODS } from '#services/moderation/lexicon'
import type { ModerationRule } from '#services/moderation/types'

const DIRECT_INTENT_PHRASES = [
  'pay me directly',
  'pay directly',
  'pay you directly',
  'send payment directly',
  'send the money directly',
  'outside the platform',
  'outside of the platform',
  'outside makexyz',
  'outside of makexyz',
  'off platform',
  'off the platform',
  'skip the platform',
  'skip the fees',
  'without the fees',
  'no fees',
  'cheaper if we',
  'cheaper outside',
  'invoice you myself',
  'invoice you directly',
  'send you an invoice',
  'i can invoice',
  'next order directly',
  'order directly from me',
  'deal directly',
  'work directly',
  'direct deal',
  'go direct',
] as const

/**
 * A payment term together with "let's do this outside MakeXYZ". Goes to
 * review; a vendor doing it alongside any contact detail is blocked outright -
 * that's the textbook fee-avoidance pitch.
 */
const paymentDirectIntent: ModerationRule = {
  id: 'payment.direct_intent',
  version: 1,
  description: 'Payment talk combined with paying/dealing outside MakeXYZ',
  defaultMode: 'shadow',
  defaultConfig: {},
  evaluate(ctx) {
    const intent = findInViews(ctx.views, DIRECT_INTENT_PHRASES)
    if (intent.length === 0) {
      return null
    }
    const methods = findInViews(ctx.views, OFF_PLATFORM_PAYMENT_METHODS, ['deobfuscated'])
    const paymentTalk =
      methods.length > 0 || /\b(?:pay|paid|payment|invoice|price)\b/.test(ctx.views.deobfuscated)
    if (!paymentTalk) {
      return null
    }

    const { signals } = ctx
    const hasContact = signals.emails.length + signals.phones.length + signals.handles.length > 0
    if (ctx.senderRole === 'vendor' && hasContact) {
      return {
        action: 'block',
        reasonCode: 'payment.direct_with_contact',
        evidence: [...intent, ...methods],
        userMessage:
          "Payments for work arranged on MakeXYZ must go through MakeXYZ, and sharing contact details isn't allowed.",
      }
    }
    return {
      action: 'review',
      reasonCode: 'payment.direct_intent',
      evidence: [...intent, ...methods],
    }
  },
}

export default paymentDirectIntent
