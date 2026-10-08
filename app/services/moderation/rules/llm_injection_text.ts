import { findInViews } from '#services/moderation/lexicon'
import type { ModerationRule } from '#services/moderation/types'

const INJECTION_PHRASES = [
  'ignore previous instructions',
  'ignore all previous',
  'ignore the above',
  'disregard previous',
  'disregard all previous',
  'system prompt',
  'you are an ai',
  'you are chatgpt',
  'as an ai language model',
  'developer mode',
  'jailbreak',
  '<system>',
  '</system>',
  '[system]',
  '[inst]',
] as const

/**
 * Text aimed at an AI moderator ("ignore previous instructions"). Not a
 * violation in itself, but rare in real messages - weight, so it can't sail
 * through on an "allow" once the LLM stage exists.
 */
const llmInjectionText: ModerationRule<{ weight: number }> = {
  id: 'llm.injection_text',
  version: 1,
  description: 'Prompt-injection phrasing aimed at AI moderation (weight)',
  defaultMode: 'shadow',
  defaultConfig: { weight: 3 },
  evaluate(ctx, config) {
    const evidence = findInViews(ctx.views, INJECTION_PHRASES, ['normalized', 'deobfuscated'])
    return evidence.length > 0
      ? { action: 'continue', reasonCode: 'llm.injection_text', weight: config.weight, evidence }
      : null
  },
}

export default llmInjectionText
