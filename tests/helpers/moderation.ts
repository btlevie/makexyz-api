import { buildViews } from '#services/moderation/normalizer'
import { extractSignals } from '#services/moderation/extractors'
import type {
  ConversationContext,
  HistoryLookups,
  ModerationRule,
  RuleContext,
  SenderRole,
} from '#services/moderation/types'

export interface ContextOverrides {
  senderRole?: SenderRole
  conversation?: Partial<ConversationContext>
  history?: Partial<HistoryLookups>
}

/** A rule context for `text`, defaulting to a vendor replying in an ongoing inquiry. */
export function contextFor(text: string, overrides: ContextOverrides = {}): RuleContext {
  const views = buildViews(text)
  return {
    views,
    signals: extractSignals(views),
    senderRole: overrides.senderRole ?? 'vendor',
    channel: 'web',
    conversation: {
      kind: 'inquiry',
      isFirstMessage: false,
      orderStatus: null,
      ...overrides.conversation,
    },
    history: { sameTextOtherConversations: 0, sameTextOtherSenders: 0, ...overrides.history },
  }
}

/** Runs one rule with its default config. */
export function run(rule: ModerationRule<any>, text: string, overrides: ContextOverrides = {}) {
  return rule.evaluate(contextFor(text, overrides), rule.defaultConfig)
}
