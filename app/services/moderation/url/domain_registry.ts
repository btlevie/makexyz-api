/**
 * The effective domain lists: the built-ins (domain_lists.ts) with moderator
 * overrides from url_domains applied on top. Read on every message send, so
 * cached briefly like the rule configs and term lists - an admin change takes
 * effect within CACHE_TTL_MS (immediately in the process that made it).
 */
import UrlDomain from '#models/url_domain'
import { BUILTIN_DOMAIN_LISTS, type DomainListStatus } from '#services/moderation/url/domain_lists'

const CACHE_TTL_MS = 60_000

export interface DomainListMatch {
  status: DomainListStatus
  /** The list entry that matched ("google.com" for "docs.google.com"), or null for none. */
  entry: string | null
  source: 'builtin' | 'admin' | null
}

export interface EffectiveDomainLists {
  /** Host suffix -> status, admin rows already applied over built-ins. */
  entries: Map<string, { status: DomainListStatus; source: 'builtin' | 'admin' }>
  /** Every allow-listed entry - also the names look-alike checks protect. */
  allowDomains: string[]
}

export function mergeDomainLists(
  rows: Pick<UrlDomain, 'domain' | 'listStatus'>[]
): EffectiveDomainLists {
  const entries = new Map<string, { status: DomainListStatus; source: 'builtin' | 'admin' }>()
  for (const [domain, status] of BUILTIN_DOMAIN_LISTS) {
    entries.set(domain, { status, source: 'builtin' })
  }
  for (const row of rows) {
    if (row.listStatus) {
      entries.set(row.domain, { status: row.listStatus, source: 'admin' })
    }
  }
  const allowDomains = [...entries]
    .filter(([, entry]) => entry.status === 'allow')
    .map(([domain]) => domain)
  return { entries, allowDomains }
}

/**
 * The list a host is on: the most specific entry that is the host itself or
 * one of its parent domains. An explicit 'none' entry stops the walk, so an
 * admin can take a subdomain off a parent's list.
 */
export function listStatusFor(hostname: string, lists: EffectiveDomainLists): DomainListMatch {
  const labels = hostname.split('.')
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.')
    const entry = lists.entries.get(candidate)
    if (entry) {
      return { status: entry.status, entry: candidate, source: entry.source }
    }
  }
  return { status: 'none', entry: null, source: null }
}

let cache: { expiresAt: number; lists: EffectiveDomainLists } | null = null

export function clearDomainListCache() {
  cache = null
}

export async function getEffectiveDomainLists(): Promise<EffectiveDomainLists> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.lists
  }
  const rows = await UrlDomain.query().whereNotNull('listStatus').select('domain', 'listStatus')
  const lists = mergeDomainLists(rows)
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, lists }
  return lists
}

/** The built-in lists alone - for pure contexts (unit tests, replays) with no database. */
export const BUILTIN_LISTS: EffectiveDomainLists = mergeDomainLists([])
