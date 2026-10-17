/**
 * The effective prohibited-item word lists: the built-in lists
 * (prohibited_terms.ts) with admin changes from moderation_terms applied.
 *
 * A moderation_terms row for a term not in the built-in list is an addition;
 * a row for a built-in term overrides it (different action, shadow,
 * disabled). Cached briefly like the rule registry, so the send path doesn't
 * read the table per message; every admin change clears the cache.
 */
import { buildViews } from '#services/moderation/normalizer'
import {
  BUILTIN_CONTEXT_ALLOWLIST,
  BUILTIN_PROHIBITED_TERMS,
  PROHIBITED_CATEGORIES,
  type ProhibitedCategory,
} from '#services/moderation/prohibited_terms'
import ModerationTerm from '#models/moderation_term'

const CACHE_TTL_MS = 60_000

export type TermAction = 'block' | 'review' | 'weight'
export type TermStatus = 'active' | 'shadow' | 'disabled'
export type TermCategory = ProhibitedCategory | 'context_allow'

export interface TermEntry {
  term: string
  category: TermCategory
  action: TermAction | null
  status: TermStatus
  source: 'builtin' | 'admin'
  /** The moderation_terms row's uuid, when one exists (an addition or an override). */
  uuid: string | null
  /** True for a built-in term an admin has changed. */
  overridden: boolean
}

/** One category's terms as the rule uses them - disabled terms are already gone. */
export interface CategoryTerms {
  block: TermEntry[]
  review: TermEntry[]
  weight: TermEntry[]
  /** Recorded when matched, never acted on. */
  shadow: TermEntry[]
}

export interface EffectiveTerms {
  categories: Record<ProhibitedCategory, CategoryTerms>
  /** Active context-allowlist words (shadow ones aren't applied). */
  contextAllow: TermEntry[]
  /** Every term, disabled ones included - for the admin listing. */
  all: TermEntry[]
}

/**
 * The form a term is stored and matched in: the same normalization message
 * text gets (NFKC, look-alikes folded, lowercased), with whitespace collapsed.
 */
export function normalizeTerm(input: string): string {
  return buildViews(input).normalized.trim().replace(/\s+/g, ' ')
}

/** The built-in lists alone, as entries - what applies when no admin has changed anything. */
export function builtinEntries(): TermEntry[] {
  const entries: TermEntry[] = []
  const add = (term: string, category: TermCategory, action: TermAction | null) =>
    entries.push({
      term: normalizeTerm(term),
      category,
      action,
      status: 'active',
      source: 'builtin',
      uuid: null,
      overridden: false,
    })
  for (const category of PROHIBITED_CATEGORIES) {
    for (const term of BUILTIN_PROHIBITED_TERMS[category].unambiguous) add(term, category, 'block')
    for (const term of BUILTIN_PROHIBITED_TERMS[category].ambiguous) add(term, category, 'weight')
  }
  for (const term of BUILTIN_CONTEXT_ALLOWLIST) add(term, 'context_allow', null)
  return entries
}

/** Applies admin rows (overrides and additions) to the built-in entries. */
export function mergeTerms(rows: ModerationTerm[]): EffectiveTerms {
  const key = (category: string, term: string) => `${category}\u0000${term}`
  const merged = new Map(builtinEntries().map((entry) => [key(entry.category, entry.term), entry]))

  for (const row of rows) {
    const existing = merged.get(key(row.category, row.term))
    merged.set(key(row.category, row.term), {
      term: row.term,
      category: row.category,
      action:
        row.category === 'context_allow' ? null : (row.action ?? existing?.action ?? 'review'),
      status: row.status,
      source: existing ? 'builtin' : 'admin',
      uuid: row.uuid,
      overridden: !!existing,
    })
  }

  const all = [...merged.values()]
  const categories = Object.fromEntries(
    PROHIBITED_CATEGORIES.map((category) => {
      const inCategory = all.filter((entry) => entry.category === category)
      const active = inCategory.filter((entry) => entry.status === 'active')
      return [
        category,
        {
          block: active.filter((entry) => entry.action === 'block'),
          review: active.filter((entry) => entry.action === 'review'),
          weight: active.filter((entry) => entry.action === 'weight'),
          shadow: inCategory.filter((entry) => entry.status === 'shadow'),
        },
      ]
    })
  ) as Record<ProhibitedCategory, CategoryTerms>

  return {
    categories,
    contextAllow: all.filter(
      (entry) => entry.category === 'context_allow' && entry.status === 'active'
    ),
    all,
  }
}

let cache: { expiresAt: number; terms: EffectiveTerms } | null = null

export function clearTermCache() {
  cache = null
}

export async function getEffectiveTerms(): Promise<EffectiveTerms> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.terms
  }
  const terms = mergeTerms(await ModerationTerm.all())
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, terms }
  return terms
}
