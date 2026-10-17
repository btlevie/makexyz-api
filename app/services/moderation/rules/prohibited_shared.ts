/**
 * Shared shape of the prohibited-item rules (docs/plans/manual_quotes.md,
 * "Prohibited items"). Each category is its own rule. Its words come from the
 * effective term list - built-in terms (prohibited_terms.ts) with admin
 * additions and overrides (moderation_terms), injected into `config.terms` by
 * the rule registry, so the rule itself does no I/O.
 *
 * - `block` terms block and open a moderation case. Next to a context word
 *   that usually means it's harmless ("airsoft", "cosplay prop", "gun rack")
 *   they escalate instead - never allow.
 * - `review` terms hold the message for a person (the default for new
 *   admin-added slang, which is often also an everyday word).
 * - `weight` terms are common in honest manufacturing talk ("trigger",
 *   "blade", "grinder"), so they only add weight - or escalate, if the rule's
 *   `ambiguousAction` config says so.
 * - `shadow` terms are recorded as evidence and never act.
 *
 * File geometry can't be checked this way - that's a known gap; vendors
 * reporting and declining prohibited work are the second line of defence.
 */
import { findTerms } from '#services/moderation/lexicon'
import type { ProhibitedCategory } from '#services/moderation/prohibited_terms'
import { mergeTerms, type CategoryTerms, type TermEntry } from '#services/moderation/term_registry'
import type { Evidence, ModerationRule, TextViews, ViewName } from '#services/moderation/types'

export const PROHIBITED_POLICY_MESSAGE =
  "This item isn't allowed on MakeXYZ. See our Prohibited items policy for what we can't make."

export interface ProhibitedConfig extends Record<string, unknown> {
  ambiguousAction: 'continue' | 'escalate'
  ambiguousWeight: number
  /** Injected by the rule registry - the effective terms for this category. */
  terms?: CategoryTerms
  /** Injected by the rule registry - the effective context allowlist. */
  contextAllow?: TermEntry[]
}

/** The terms that matched, as evidence naming the exact list entry that fired. */
function matchEntries(views: TextViews, entries: TermEntry[], viewNames: ViewName[]): Evidence[] {
  if (entries.length === 0) {
    return []
  }
  const byTerm = new Map(entries.map((entry) => [entry.term, entry]))
  const evidence = new Map<string, Evidence>()
  for (const view of viewNames) {
    for (const match of findTerms(views[view], [...byTerm.keys()])) {
      const entry = byTerm.get(match.replace(/\s+/g, ' '))
      if (entry && !evidence.has(entry.term)) {
        evidence.set(entry.term, {
          view,
          match: entry.term,
          termSource: entry.source,
          termUuid: entry.uuid,
          ...(entry.status === 'shadow' ? { termStatus: 'shadow' as const } : {}),
        })
      }
    }
  }
  return [...evidence.values()]
}

/** Views for strong terms: obfuscation undone. Weight terms skip leetspeak to limit false positives. */
const STRONG_VIEWS: ViewName[] = ['deobfuscated', 'compact']
const WEIGHT_VIEWS: ViewName[] = ['deobfuscated']

export function prohibitedRule(definition: {
  id: string
  category: ProhibitedCategory
  description: string
}): ModerationRule<ProhibitedConfig> {
  return {
    id: definition.id,
    version: 2,
    description: definition.description,
    defaultMode: 'enforce',
    defaultConfig: { ambiguousAction: 'continue', ambiguousWeight: 1 },
    termCategory: definition.category,
    evaluate(ctx, config) {
      // Without injected terms (e.g. a unit test calling the rule directly),
      // the built-in lists apply.
      const builtin = config.terms && config.contextAllow ? null : mergeTerms([])
      const terms = config.terms ?? builtin!.categories[definition.category]
      const contextAllow = config.contextAllow ?? builtin!.contextAllow

      const shadow = matchEntries(ctx.views, terms.shadow, STRONG_VIEWS)

      const certain = matchEntries(ctx.views, terms.block, STRONG_VIEWS)
      if (certain.length > 0) {
        const context = matchEntries(ctx.views, contextAllow, ['deobfuscated'])
        if (context.length > 0) {
          return {
            action: 'escalate',
            reasonCode: `${definition.id}_in_context`,
            evidence: [...certain, ...context, ...shadow],
          }
        }
        return {
          action: 'block',
          reasonCode: definition.id,
          evidence: [...certain, ...shadow],
          userMessage: PROHIBITED_POLICY_MESSAGE,
          caseSource: 'prohibited_item',
        }
      }

      const review = matchEntries(ctx.views, terms.review, STRONG_VIEWS)
      if (review.length > 0) {
        return {
          action: 'escalate',
          reasonCode: `${definition.id}_review_term`,
          evidence: [...review, ...shadow],
        }
      }

      const possible = matchEntries(ctx.views, terms.weight, WEIGHT_VIEWS)
      if (possible.length > 0) {
        return config.ambiguousAction === 'escalate'
          ? {
              action: 'escalate',
              reasonCode: `${definition.id}_possible`,
              evidence: [...possible, ...shadow],
            }
          : {
              action: 'continue',
              reasonCode: `${definition.id}_possible`,
              weight: config.ambiguousWeight,
              evidence: [...possible, ...shadow],
            }
      }

      // Only shadow terms matched: a weight-0 hit, so the term builds a track
      // record without affecting delivery.
      return shadow.length > 0
        ? {
            action: 'continue',
            reasonCode: `${definition.id}_shadow_term`,
            weight: 0,
            evidence: shadow,
          }
        : null
    },
  }
}
