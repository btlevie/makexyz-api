import { findInViews } from '#services/moderation/lexicon'
import type { Evidence, ModerationRule } from '#services/moderation/types'

/** Promotional phrasing - shared with context.off_topic_commercial and ad.unrelated_url. */
export const PROMO_PHRASES = [
  'check out my',
  'check out our',
  'visit my',
  'visit our',
  'our website',
  'my website',
  'my shop',
  'our shop',
  'my store',
  'our store',
  'my etsy',
  'promo code',
  'discount code',
  'coupon code',
  'percent off',
  'limited time',
  'special offer',
  'exclusive offer',
  'follow us',
  'follow me',
  'subscribe to',
  'we also offer',
  'i also offer',
  'my other services',
  'free trial',
  'best prices',
  'lowest prices',
  'click here',
  'sign up now',
  'order now',
] as const

const PERCENT_OFF = /\b\d{1,2}\s?%\s?off\b/

export function promoEvidence(ctx: Parameters<ModerationRule['evaluate']>[0]): Evidence[] {
  const evidence = findInViews(ctx.views, PROMO_PHRASES)
  const percent = ctx.views.deobfuscated.match(PERCENT_OFF)
  if (percent) evidence.push({ view: 'deobfuscated', match: percent[0] })
  return evidence
}

/**
 * Promotional language. Weight on its own (a vendor saying "we also offer
 * painting" in a real thread is fine); with a link it escalates, since a
 * promo plus a URL is the shape of most advertising.
 */
const adPromoLanguage: ModerationRule<{ weight: number }> = {
  id: 'ad.promo_language',
  version: 1,
  description: 'Promotional phrasing (weight; escalates when a link is included)',
  defaultMode: 'shadow',
  defaultConfig: { weight: 2 },
  evaluate(ctx, config) {
    const evidence = promoEvidence(ctx)
    if (evidence.length === 0) {
      return null
    }
    if (ctx.signals.urls.length > 0) {
      return { action: 'escalate', reasonCode: 'ad.promo_with_link', evidence }
    }
    return { action: 'continue', reasonCode: 'ad.promo_language', weight: config.weight, evidence }
  },
}

export default adPromoLanguage
