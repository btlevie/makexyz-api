import { findInViews } from '#services/moderation/lexicon'
import type { ModerationRule } from '#services/moderation/types'

const SOLICITATION_PHRASES = [
  'text me',
  'call me',
  'email me',
  'e-mail me',
  'message me on',
  'message me at',
  'reach me at',
  'reach me on',
  'contact me at',
  'contact me on',
  'contact me directly',
  'my number is',
  'my cell',
  'my phone number',
  'my email is',
  'my email address',
  'dm me',
  'find me on',
  'add me on',
  'hit me up on',
  'ping me on',
  'my whatsapp',
  'my telegram',
  'talk off platform',
  'talk outside',
  'continue this elsewhere',
] as const

/**
 * Asking to move the conversation elsewhere without (yet) giving the detail.
 * Context decides - "call me when it ships" is usually innocent - so this
 * escalates rather than blocks.
 */
const contactSolicitation: ModerationRule = {
  id: 'contact.solicitation',
  version: 1,
  description: 'Asking to be contacted off MakeXYZ ("text me", "my number is")',
  defaultMode: 'shadow',
  defaultConfig: {},
  evaluate(ctx) {
    const evidence = findInViews(ctx.views, SOLICITATION_PHRASES)
    return evidence.length > 0
      ? { action: 'escalate', reasonCode: 'contact.solicitation', evidence }
      : null
  },
}

export default contactSolicitation
