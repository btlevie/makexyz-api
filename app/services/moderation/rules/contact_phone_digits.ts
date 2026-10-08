import type { ModerationRule } from '#services/moderation/types'

/**
 * A 10-15 digit run that isn't a valid phone number but might be one written
 * to slip past contact.phone ("4 1 5 5 5 5 2 6 7 1"). Order, tracking and
 * dimension contexts are already excluded by the extractor. Escalates - the
 * extractor can't be sure.
 */
const contactPhoneDigits: ModerationRule = {
  id: 'contact.phone_digits',
  version: 1,
  description: 'Long digit runs that may be a disguised phone number',
  defaultMode: 'shadow',
  defaultConfig: {},
  evaluate(ctx) {
    const runs = ctx.signals.digitRuns
    return runs.length > 0
      ? {
          action: 'escalate',
          reasonCode: 'contact.phone_digits',
          evidence: runs.map((run) => ({ view: 'numeric' as const, match: run.digits })),
        }
      : null
  },
}

export default contactPhoneDigits
