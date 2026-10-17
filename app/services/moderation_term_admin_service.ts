/**
 * Admin management of the prohibited-item word lists: list the effective
 * terms with how often each fired, add slang, override or disable built-ins,
 * and preview a term against recent messages before switching it on. Every
 * change is logged to moderation_actions. See term_registry.ts for how the
 * built-in lists and moderation_terms combine.
 */
import string from '@adonisjs/core/helpers/string'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Message from '#models/message'
import ModerationRuleHit from '#models/moderation_rule_hit'
import ModerationTerm from '#models/moderation_term'
import type User from '#models/user'
import { findTerms, WORK_CONTEXT_TERMS } from '#services/moderation/lexicon'
import { buildViews } from '#services/moderation/normalizer'
import {
  builtinEntries,
  clearTermCache,
  getEffectiveTerms,
  normalizeTerm,
  type TermAction,
  type TermCategory,
  type TermEntry,
  type TermStatus,
} from '#services/moderation/term_registry'
import { recordModerationAction } from '#services/moderation_action_service'

/** Hit counts and previews look back this far. */
const WINDOW_DAYS = 30
/** Preview scans at most this many of the most recent messages. */
const PREVIEW_SCAN_LIMIT = 5000
const PREVIEW_SAMPLE_LIMIT = 10
const SNIPPET_RADIUS = 40

export class TermConflictError extends Error {
  constructor(public existingUuid: string) {
    super('This term already has an entry - change it instead')
    this.name = 'TermConflictError'
  }
}

export class InvalidTermError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidTermError'
  }
}

export interface TermView extends TermEntry {
  note: string | null
  updatedAt: DateTime | null
  hits30d: number
}

function entryKey(category: string, term: string) {
  return `${category}:${term}`
}

/** Normalizes and checks a term an admin typed. */
function prepareTerm(category: TermCategory, rawTerm: string, action: TermAction | null) {
  const term = normalizeTerm(rawTerm)
  if (term.length < 2 || term.length > 60) {
    throw new InvalidTermError('A term must be 2-60 characters')
  }
  if (!/[a-z]/.test(term)) {
    throw new InvalidTermError('A term must contain at least one letter')
  }
  if (category === 'context_allow' && action) {
    throw new InvalidTermError('Context words have no action - leave it out')
  }
  return term
}

/** How often each term matched in prohibited-item rule hits over the window. */
async function hitCounts(): Promise<Map<string, number>> {
  const since = DateTime.now().minus({ days: WINDOW_DAYS }).toSQL()!
  const hits = await ModerationRuleHit.query()
    .where('ruleId', 'like', 'prohibited.%')
    .where('createdAt', '>', since)
    .select('ruleId', 'evidence')
  const counts = new Map<string, number>()
  for (const hit of hits) {
    const category = hit.ruleId.replace('prohibited.', '')
    for (const evidence of hit.evidence ?? []) {
      if (!evidence.termSource) continue
      const key = entryKey(category, evidence.match)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/** Every term (built-in and admin, disabled included), with notes and 30-day hits. */
export async function listTerms(filters: {
  category?: TermCategory
  status?: TermStatus
  q?: string
}): Promise<TermView[]> {
  const [{ all }, rows, counts] = await Promise.all([
    getEffectiveTerms(),
    ModerationTerm.all(),
    hitCounts(),
  ])
  const rowsByUuid = new Map(rows.map((row) => [row.uuid, row]))
  const query = filters.q ? normalizeTerm(filters.q) : null

  return all
    .filter((entry) => !filters.category || entry.category === filters.category)
    .filter((entry) => !filters.status || entry.status === filters.status)
    .filter((entry) => !query || entry.term.includes(query))
    .map((entry) => {
      const row = entry.uuid ? rowsByUuid.get(entry.uuid) : undefined
      return {
        ...entry,
        note: row?.note ?? null,
        updatedAt: row?.updatedAt ?? null,
        hits30d: counts.get(entryKey(entry.category, entry.term)) ?? 0,
      }
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.term.localeCompare(b.term))
}

function auditAction(before: TermStatus | null, after: TermStatus, isNew: boolean) {
  if (after === 'disabled' && before !== 'disabled') return 'term_disabled' as const
  return isNew ? ('term_added' as const) : ('term_updated' as const)
}

/**
 * Adds a term, or the first override of a built-in. A new term holds
 * messages for review unless told otherwise; a built-in keeps its own
 * action unless one is given.
 */
export async function addTerm(
  input: {
    category: TermCategory
    term: string
    action?: TermAction
    status?: TermStatus
    note?: string
  },
  admin: User
): Promise<ModerationTerm> {
  const term = prepareTerm(input.category, input.term, input.action ?? null)

  const existing = await ModerationTerm.query()
    .where('category', input.category)
    .where('term', term)
    .first()
  if (existing) {
    throw new TermConflictError(existing.uuid)
  }

  const builtin = builtinEntries().find(
    (entry) => entry.category === input.category && entry.term === term
  )
  const action =
    input.category === 'context_allow' ? null : (input.action ?? builtin?.action ?? 'review')
  const status = input.status ?? 'active'

  const row = await db.transaction(async (trx) => {
    const created = await ModerationTerm.create(
      {
        uuid: string.uuid(),
        category: input.category,
        term,
        action,
        status,
        note: input.note ?? null,
        createdById: admin.id,
        updatedById: admin.id,
      },
      { client: trx }
    )
    await recordModerationAction(
      {
        actorUserId: admin.id,
        action: auditAction(builtin ? 'active' : null, status, !builtin),
        targetType: 'term',
        targetId: entryKey(input.category, term),
        reason: input.note,
        metadata: {
          before: builtin ? { action: builtin.action, status: 'active', source: 'builtin' } : null,
          after: { action, status },
        },
      },
      trx
    )
    return created
  })

  clearTermCache()
  return row
}

export async function updateTerm(
  row: ModerationTerm,
  changes: { action?: TermAction; status?: TermStatus; note?: string },
  admin: User
): Promise<ModerationTerm> {
  if (row.category === 'context_allow' && changes.action) {
    throw new InvalidTermError('Context words have no action - leave it out')
  }
  const before = { action: row.action, status: row.status, note: row.note }

  await db.transaction(async (trx) => {
    row.useTransaction(trx)
    row.merge({
      ...(changes.action !== undefined ? { action: changes.action } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      ...(changes.note !== undefined ? { note: changes.note } : {}),
      updatedById: admin.id,
    })
    await row.save()
    await recordModerationAction(
      {
        actorUserId: admin.id,
        action: auditAction(before.status, row.status, false),
        targetType: 'term',
        targetId: entryKey(row.category, row.term),
        reason: changes.note,
        metadata: { before, after: { action: row.action, status: row.status, note: row.note } },
      },
      trx
    )
  })

  clearTermCache()
  return row
}

export interface TermPreview {
  term: string
  scanned: number
  matches: number
  samples: {
    messageUuid: string
    status: Message['status']
    snippet: string
    createdAt: DateTime | null
  }[]
  warnings: string[]
}

/**
 * What a term would catch, without changing anything: matches among recent
 * messages (any status), with a few samples, and warnings for terms likely to
 * misfire.
 */
export async function previewTerm(category: TermCategory, rawTerm: string): Promise<TermPreview> {
  const term = prepareTerm(category, rawTerm, null)
  const since = DateTime.now().minus({ days: WINDOW_DAYS }).toSQL()!
  const messages = await Message.query()
    .where('createdAt', '>', since)
    .where('kind', 'text')
    .orderBy('id', 'desc')
    .limit(PREVIEW_SCAN_LIMIT)

  let matches = 0
  const samples: TermPreview['samples'] = []
  for (const message of messages) {
    const views = buildViews(message.body)
    const hit =
      findTerms(views.deobfuscated, [term])[0] ?? findTerms(views.compact, [term])[0] ?? null
    if (!hit) continue
    matches++
    if (samples.length < PREVIEW_SAMPLE_LIMIT) {
      const at = Math.max(0, views.normalized.indexOf(hit))
      samples.push({
        messageUuid: message.uuid,
        status: message.status,
        snippet: views.normalized.slice(
          Math.max(0, at - SNIPPET_RADIUS),
          at + hit.length + SNIPPET_RADIUS
        ),
        createdAt: message.createdAt,
      })
    }
  }

  const warnings: string[] = []
  if (term.replace(/[^a-z]/g, '').length < 3) {
    warnings.push('Very short terms match a lot of unrelated text.')
  }
  if (findTerms(term, WORK_CONTEXT_TERMS).length > 0) {
    warnings.push('This is also an everyday manufacturing word - consider "review" or "weight".')
  }

  return { term, scanned: messages.length, matches, samples, warnings }
}
