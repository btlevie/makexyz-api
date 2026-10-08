import {
  CHAT_INVITE_HOSTS,
  CHAT_PLATFORMS,
  findInViews,
  findTerms,
} from '#services/moderation/lexicon'
import type { Evidence, ModerationRule } from '#services/moderation/types'

/** Phrases that turn a platform mention into "here's how to reach me there". */
const HANDLE_PHRASES = [
  'my id',
  'my username',
  'my user name',
  'my handle',
  'add me',
  'hit me up',
  'find me',
  'look me up',
  'search for me',
  'my name on',
  'my account',
] as const

/**
 * Moving the conversation to a chat app or social network. An invite link
 * (discord.gg, t.me, wa.me...) or a platform named alongside a handle, number
 * or "add me" blocks; a bare platform mention escalates, since "I saw your
 * work on Instagram" is harmless.
 */
const contactPlatformHandle: ModerationRule = {
  id: 'contact.platform_handle',
  version: 1,
  description: 'Chat-app/social invites, or a platform named with a handle or number',
  defaultMode: 'shadow',
  defaultConfig: {},
  evaluate(ctx) {
    const invites: Evidence[] = ctx.signals.urls
      .filter((url) =>
        CHAT_INVITE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
      )
      .map((url) => ({ view: 'deobfuscated', match: url.match }))
    const platforms = findInViews(ctx.views, CHAT_PLATFORMS)
    const userMessage =
      "Sharing other ways to contact you isn't allowed on MakeXYZ. Please keep the conversation here."

    if (invites.length > 0) {
      return {
        action: 'block',
        reasonCode: 'contact.platform_invite',
        evidence: invites,
        userMessage,
      }
    }
    if (platforms.length === 0) {
      return null
    }

    const handleEvidence: Evidence[] = [
      ...ctx.signals.handles.map((handle) => ({
        view: 'deobfuscated' as const,
        match: `@${handle.handle}`,
      })),
      ...ctx.signals.phones.map((phone) => ({ view: 'normalized' as const, match: phone.match })),
      ...findTerms(ctx.views.compact, HANDLE_PHRASES).map((match) => ({
        view: 'compact' as const,
        match,
      })),
    ]
    if (handleEvidence.length > 0) {
      return {
        action: 'block',
        reasonCode: 'contact.platform_handle',
        evidence: [...platforms, ...handleEvidence],
        userMessage,
      }
    }
    return { action: 'escalate', reasonCode: 'contact.platform_mention', evidence: platforms }
  },
}

export default contactPlatformHandle
