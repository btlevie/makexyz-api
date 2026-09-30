import type { ModerationRule } from '#services/moderation/types'

/**
 * Email addresses, plain or obfuscated ("jo[at]gmail[dot]com"). Sharing any
 * contact detail is blocked in every conversation, in both directions, for
 * the whole lifecycle - the platform is the channel.
 *
 * An address that only appears after rewriting a bare " at " ("jo at gmail
 * dot com") goes to review instead: the same rewrite turns "look at
 * example.com" into an address, so it isn't certain enough to block.
 */
const contactEmail: ModerationRule = {
  id: 'contact.email',
  version: 1,
  description: 'Email addresses, including bracket-obfuscated ones',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const { emails } = ctx.signals
    if (emails.length === 0) {
      return null
    }

    const certain = emails.filter((email) => email.view !== 'deobfuscatedLoose')
    const evidence = emails.map((email) => ({ view: email.view, match: email.address }))

    if (certain.length > 0) {
      return {
        action: 'block',
        reasonCode: 'contact.email',
        evidence,
        userMessage:
          "Sharing email addresses isn't allowed on MakeXYZ. Please keep the conversation here.",
      }
    }
    return { action: 'review', reasonCode: 'contact.email_possible', evidence }
  },
}

export default contactEmail
