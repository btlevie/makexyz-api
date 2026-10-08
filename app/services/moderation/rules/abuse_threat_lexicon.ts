import { findInViews } from '#services/moderation/lexicon'
import type { ModerationRule } from '#services/moderation/types'

const THREAT_PHRASES = [
  'i will find you',
  "i'll find you",
  'i know where you live',
  'you will regret',
  "you'll regret",
  'watch your back',
  'i will hurt you',
  "i'll hurt you",
  'kill you',
  "i'll kill",
  'going to kill',
  'beat you up',
  'dox you',
  'doxx you',
  'doxxing',
  'post your address',
] as const

/** Threats against the other person. Always a human decision - never auto-blocked. */
const abuseThreatLexicon: ModerationRule = {
  id: 'abuse.threat_lexicon',
  version: 1,
  description: 'Threatening phrases (always human review)',
  defaultMode: 'shadow',
  defaultConfig: {},
  evaluate(ctx) {
    const evidence = findInViews(ctx.views, THREAT_PHRASES)
    return evidence.length > 0 ? { action: 'review', reasonCode: 'abuse.threat', evidence } : null
  },
}

export default abuseThreatLexicon
