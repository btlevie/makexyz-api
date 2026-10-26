import type { ModerationRule } from '#services/moderation/types'

/**
 * Text a moderator already blocked as spam, advertising or a scam, sent again
 * - by anyone. Blocks at once with the generic reason, so one human decision
 * stops a blast across every account sending it. Very short texts never
 * match, so a generic line can't be blocked for everyone by accident.
 */
const spamKnownBlockedText: ModerationRule<{ minLength: number }> = {
  id: 'spam.known_blocked_text',
  version: 1,
  description: 'Exact text a moderator blocked as spam, advertising or a scam',
  defaultMode: 'enforce',
  defaultConfig: { minLength: 20 },
  evaluate(ctx, config) {
    if (
      ctx.history.humanBlockedSameText === 0 ||
      ctx.views.normalized.trim().length < config.minLength
    ) {
      return null
    }
    return {
      action: 'block',
      reasonCode: 'spam.known_blocked_text',
      evidence: [
        {
          view: 'normalized',
          match: `same text a moderator blocked ${ctx.history.humanBlockedSameText} time(s)`,
        },
      ],
    }
  },
}

export default spamKnownBlockedText
