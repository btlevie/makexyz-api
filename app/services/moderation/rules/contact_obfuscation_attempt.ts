import { CHAT_PLATFORMS, findTerms } from '#services/moderation/lexicon'
import type { Evidence, ModerationRule } from '#services/moderation/types'

/**
 * A contact detail that only appears once tricks are undone - "jo [at] gmail
 * [dot] com", a phone number spelled out in words, "d1sc0rd". Hiding it is
 * itself strong evidence of intent, so this blocks even when the plain
 * detail rule wouldn't.
 */
const contactObfuscationAttempt: ModerationRule = {
  id: 'contact.obfuscation_attempt',
  version: 1,
  description: 'Contact details hidden with obfuscation (brackets, spelled-out digits, leetspeak)',
  defaultMode: 'shadow',
  defaultConfig: {},
  evaluate(ctx) {
    const { views, signals } = ctx
    const evidence: Evidence[] = []

    for (const email of signals.emails) {
      if (email.view !== 'normalized') evidence.push({ view: email.view, match: email.address })
    }
    for (const phone of signals.phones) {
      if (!views.normalized.includes(phone.match))
        evidence.push({ view: 'numeric', match: phone.match })
    }
    const plainPlatforms = new Set(findTerms(views.deobfuscated, CHAT_PLATFORMS))
    for (const platform of findTerms(views.compact, CHAT_PLATFORMS)) {
      if (!plainPlatforms.has(platform)) evidence.push({ view: 'compact', match: platform })
    }

    return evidence.length > 0
      ? {
          action: 'block',
          reasonCode: 'contact.obfuscated',
          evidence,
          userMessage:
            "Sharing contact details isn't allowed on MakeXYZ. Please keep the conversation here.",
        }
      : null
  },
}

export default contactObfuscationAttempt
