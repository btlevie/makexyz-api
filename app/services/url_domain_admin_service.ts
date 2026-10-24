/**
 * Admin management of the link domain lists (allow / block / user content):
 * list domains as they're effectively treated - built-ins merged with
 * url_domains overrides - with how widely each has been seen and its age,
 * and set or clear an override. Every change is logged to
 * moderation_actions. See url/domain_registry.ts for how lists resolve.
 */
import db from '@adonisjs/lucid/services/db'
import { domainToASCII } from 'node:url'
import { parse } from 'tldts'
import type { DateTime } from 'luxon'
import UrlDomain from '#models/url_domain'
import type User from '#models/user'
import { BUILTIN_DOMAIN_LISTS, type DomainListStatus } from '#services/moderation/url/domain_lists'
import { clearDomainListCache } from '#services/moderation/url/domain_registry'
import { recordModerationAction } from '#services/moderation_action_service'

const LIST_LIMIT = 200

export class InvalidDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDomainError'
  }
}

export interface DomainView {
  domain: string
  /** How it's treated now: the override if there is one, else the built-in. */
  listStatus: DomainListStatus
  builtinStatus: DomainListStatus | null
  overridden: boolean
  note: string | null
  seenCount: number
  firstSeenAt: DateTime | null
  lastSeenAt: DateTime | null
  registeredAt: DateTime | null
}

/** A domain an admin typed, as stored: lowercase ASCII (punycode), no scheme or path. */
export function normalizeDomain(input: string): string {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#:]/)[0]
    .replace(/\.$/, '')
  const ascii = domainToASCII(host)
  const parsed = parse(ascii)
  if (!ascii || !parsed.domain || !parsed.isIcann || parsed.isIp) {
    throw new InvalidDomainError('Enter a domain like example.com or files.example.com')
  }
  return ascii
}

function viewOf(domain: string, row: UrlDomain | null): DomainView {
  const builtinStatus = BUILTIN_DOMAIN_LISTS.get(domain) ?? null
  return {
    domain,
    listStatus: row?.listStatus ?? builtinStatus ?? 'none',
    builtinStatus,
    overridden: Boolean(row?.listStatus),
    note: row?.note ?? null,
    seenCount: row?.seenCount ?? 0,
    firstSeenAt: row?.firstSeenAt ?? null,
    lastSeenAt: row?.lastSeenAt ?? null,
    registeredAt: row?.registeredAt ?? null,
  }
}

/**
 * Built-in entries plus every domain with a row (overridden or just seen),
 * most recently seen first. `list` filters by effective status; `q` by
 * substring.
 */
export async function listDomains(filters: {
  list?: DomainListStatus
  q?: string
}): Promise<DomainView[]> {
  const rows = await UrlDomain.query()
    .if(filters.q, (query) => query.whereLike('domain', `%${filters.q!.toLowerCase()}%`))
    .orderByRaw('last_seen_at is null, last_seen_at desc')
    .limit(LIST_LIMIT * 5)
  const byDomain = new Map(rows.map((row) => [row.domain, row]))

  const views = new Map<string, DomainView>()
  for (const [domain] of BUILTIN_DOMAIN_LISTS) {
    if (!filters.q || domain.includes(filters.q.toLowerCase())) {
      views.set(domain, viewOf(domain, byDomain.get(domain) ?? null))
    }
  }
  for (const row of rows) {
    views.set(row.domain, viewOf(row.domain, row))
  }

  return [...views.values()]
    .filter((view) => !filters.list || view.listStatus === filters.list)
    .sort((a, b) => (b.lastSeenAt?.toMillis() ?? 0) - (a.lastSeenAt?.toMillis() ?? 0))
    .slice(0, LIST_LIMIT)
}

/**
 * Sets (or with null, clears) a domain's list override. A host like
 * files.example.com can be listed separately from example.com - the most
 * specific entry wins.
 */
export async function setDomainList(
  input: { domain: string; listStatus: DomainListStatus | null; note?: string },
  admin: User
): Promise<DomainView> {
  const domain = normalizeDomain(input.domain)

  const row = await db.transaction(async (trx) => {
    const existing = await UrlDomain.query({ client: trx })
      .where('domain', domain)
      .forUpdate()
      .first()
    const before = existing?.listStatus ?? null
    const saved = existing ?? new UrlDomain().merge({ domain, seenCount: 0 })
    saved.useTransaction(trx)
    saved.merge({
      listStatus: input.listStatus,
      note: input.note ?? saved.note ?? null,
      updatedById: admin.id,
    })
    await saved.save()

    await recordModerationAction(
      {
        actorUserId: admin.id,
        action: 'domain_list_updated',
        targetType: 'domain',
        targetId: domain,
        reason: input.note ?? null,
        metadata: { before, after: input.listStatus },
      },
      trx
    )
    return saved
  })

  clearDomainListCache()
  return viewOf(domain, row)
}
