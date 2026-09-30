import type { ModerationRule } from '#services/moderation/types'

/**
 * Valid phone numbers (libphonenumber full metadata). Blocked in every
 * conversation, like email addresses.
 */
const contactPhone: ModerationRule = {
  id: 'contact.phone',
  version: 1,
  description: 'Valid phone numbers',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const { phones } = ctx.signals
    if (phones.length === 0) {
      return null
    }
    return {
      action: 'block',
      reasonCode: 'contact.phone',
      evidence: phones.map((phone) => ({ view: 'normalized' as const, match: phone.match })),
      userMessage:
        "Sharing phone numbers isn't allowed on MakeXYZ. Please keep the conversation here.",
    }
  },
}

export default contactPhone
