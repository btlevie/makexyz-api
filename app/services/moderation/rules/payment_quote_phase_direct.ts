import { findInViews, OFF_PLATFORM_PAYMENT_METHODS } from '#services/moderation/lexicon'
import type { ModerationRule } from '#services/moderation/types'

const PRICING_TERMS = [
  'price',
  'pricing',
  'quote',
  'cost',
  'discount',
  'cheaper',
  'rate',
  'per unit',
  'total',
] as const

/** "15% off" is price talk too. */
const PERCENT_OFF = /\b\d{1,2}\s?%\s?off\b/

const DIRECT_TERMS = [
  'invoice',
  'direct',
  'directly',
  'outside',
  'no fee',
  'no fees',
  'cheaper if',
  'my own site',
  'my website',
  'my shop',
] as const

/**
 * The moment before a quote is accepted is when "pay me directly and save
 * the fee" pays off for a vendor. In an inquiry (no order yet), a vendor
 * talking price together with invoicing/direct/outside terms or a payment
 * method goes to review.
 */
const paymentQuotePhaseDirect: ModerationRule = {
  id: 'payment.quote_phase_direct',
  version: 1,
  description: 'Vendor price talk plus going direct, before an order exists',
  defaultMode: 'shadow',
  defaultConfig: {},
  senderRoles: ['vendor'],
  evaluate(ctx) {
    if (ctx.conversation.kind !== 'inquiry' || ctx.conversation.orderStatus) {
      return null
    }
    const pricing = findInViews(ctx.views, PRICING_TERMS, ['deobfuscated'])
    const percentOff = ctx.views.deobfuscated.match(PERCENT_OFF)
    if (percentOff) pricing.push({ view: 'deobfuscated', match: percentOff[0] })
    if (pricing.length === 0) {
      return null
    }
    const direct = [
      ...findInViews(ctx.views, DIRECT_TERMS, ['deobfuscated']),
      ...findInViews(ctx.views, OFF_PLATFORM_PAYMENT_METHODS, ['deobfuscated']),
    ]
    return direct.length > 0
      ? {
          action: 'review',
          reasonCode: 'payment.quote_phase_direct',
          evidence: [...pricing, ...direct],
        }
      : null
  },
}

export default paymentQuotePhaseDirect
