/**
 * Shared shape of the prohibited-item rules (docs/plans/manual_quotes.md,
 * "Prohibited items"). Each category is its own rule with its own word lists:
 *
 * - An unambiguous term ("auto sear", "card skimmer") blocks and opens a
 *   moderation case. Enforced from launch.
 * - The same term next to a context word that usually means it's harmless
 *   ("airsoft", "cosplay prop", "gun rack") escalates instead - never allows.
 * - An ambiguous term ("trigger", "blade", "grinder") is common in honest
 *   manufacturing talk, so by default it only adds weight. Set the rule's
 *   `ambiguousAction` config to 'escalate' to send those to review instead.
 *
 * File geometry can't be checked this way - that's a known gap; vendors
 * reporting and declining prohibited work are the second line of defence.
 */
import { findInViews } from '#services/moderation/lexicon'
import type { ModerationRule } from '#services/moderation/types'

/** Context that makes a weapon-ish term usually innocent. Lowers block to escalate. */
export const PROHIBITED_CONTEXT_ALLOWLIST = [
  'airsoft',
  'nerf',
  'cosplay',
  'prop',
  'props',
  'prop replica',
  'non functional',
  'non-functional',
  'toy',
  'model kit',
  'scale model',
  'display stand',
  'display case',
  'wall mount',
  'gun rack',
  'magazine rack',
  'magazine holder',
  'magazine file',
  'knife block',
  'knife holder',
] as const

export const PROHIBITED_POLICY_MESSAGE =
  "This item isn't allowed on MakeXYZ. See our Prohibited items policy for what we can't make."

export interface ProhibitedConfig extends Record<string, unknown> {
  ambiguousAction: 'continue' | 'escalate'
  ambiguousWeight: number
}

export function prohibitedRule(definition: {
  id: string
  description: string
  unambiguous: readonly string[]
  ambiguous: readonly string[]
}): ModerationRule<ProhibitedConfig> {
  return {
    id: definition.id,
    version: 1,
    description: definition.description,
    defaultMode: 'enforce',
    defaultConfig: { ambiguousAction: 'continue', ambiguousWeight: 1 },
    evaluate(ctx, config) {
      const certain = findInViews(ctx.views, definition.unambiguous)
      if (certain.length > 0) {
        const context = findInViews(ctx.views, PROHIBITED_CONTEXT_ALLOWLIST, ['deobfuscated'])
        if (context.length > 0) {
          return {
            action: 'escalate',
            reasonCode: `${definition.id}_in_context`,
            evidence: [...certain, ...context],
          }
        }
        return {
          action: 'block',
          reasonCode: definition.id,
          evidence: certain,
          userMessage: PROHIBITED_POLICY_MESSAGE,
          caseSource: 'prohibited_item',
        }
      }

      const possible = findInViews(ctx.views, definition.ambiguous, ['deobfuscated'])
      if (possible.length === 0) {
        return null
      }
      return config.ambiguousAction === 'escalate'
        ? { action: 'escalate', reasonCode: `${definition.id}_possible`, evidence: possible }
        : {
            action: 'continue',
            reasonCode: `${definition.id}_possible`,
            weight: config.ambiguousWeight,
            evidence: possible,
          }
    },
  }
}
