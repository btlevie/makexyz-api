import { findInViews, WORK_CONTEXT_TERMS } from '#services/moderation/lexicon'
import type { ModerationRule } from '#services/moderation/types'

const PITCH_PHRASES = [
  'your business',
  'your website',
  'your company',
  'your brand',
  'seo',
  'search engine',
  'google ranking',
  'first page of google',
  'leads',
  'lead generation',
  'partnership',
  'partner with',
  'we help manufacturers',
  'we help businesses',
  'grow your',
  'increase your sales',
  'marketing services',
  'digital marketing',
  'web design',
  'website design',
  'backlinks',
  'guest post',
  'social media management',
  'virtual assistant',
  'outsourcing',
  'app development',
] as const

/**
 * An inquiry that pitches a service to the vendor instead of asking for work
 * - the SEO agency, the "partnership" offer. Only the opener of an inquiry,
 * and only when nothing in it is about parts, materials or quantities.
 */
const inquiryColdPitch: ModerationRule = {
  id: 'inquiry.cold_pitch',
  version: 1,
  description: 'Inquiry openers pitching services to the vendor rather than requesting work',
  defaultMode: 'shadow',
  defaultConfig: {},
  senderRoles: ['customer'],
  evaluate(ctx) {
    if (ctx.conversation.kind !== 'inquiry' || !ctx.conversation.isFirstMessage) {
      return null
    }
    const pitch = findInViews(ctx.views, PITCH_PHRASES)
    if (
      pitch.length === 0 ||
      findInViews(ctx.views, WORK_CONTEXT_TERMS, ['deobfuscated']).length > 0
    ) {
      return null
    }
    return ctx.signals.urls.length > 0
      ? { action: 'review', reasonCode: 'inquiry.cold_pitch_link', evidence: pitch }
      : { action: 'escalate', reasonCode: 'inquiry.cold_pitch', evidence: pitch }
  },
}

export default inquiryColdPitch
