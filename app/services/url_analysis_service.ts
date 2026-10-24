/**
 * The async half of link safety (docs/plans/messaging_moderation.md, section
 * 2a): for one normalized URL, follow its redirects (shorteners and unknown
 * domains only), ask Google Web Risk about the original and final URL, look
 * up the final domain's age over RDAP, and cache the verdict in url_scans.
 * Each URL is analysed once per cache lifetime however many messages
 * contain it. Runs from AnalyzeMessage, RescanRecentUrls and the link
 * interstitial - never in the send path.
 *
 * Cache lifetimes: malicious 30 days; safe 24 hours (or less, if Web Risk
 * says so); unknown 6 hours; a failed lookup 15 minutes, so it's retried
 * soon.
 */
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { getDomain } from 'tldts'
import env from '#start/env'
import Message from '#models/message'
import MessageUrl from '#models/message_url'
import UrlDomain from '#models/url_domain'
import UrlScan from '#models/url_scan'
import { getEffectiveDomainLists, listStatusFor } from '#services/moderation/url/domain_registry'
import { FakeUrlFetcher } from '#services/moderation/url/fake_url_fetcher'
import { normalizeUrl } from '#services/moderation/url/normalize'
import {
  FakeRdapClient,
  IanaRdapClient,
  type RdapClient,
} from '#services/moderation/url/rdap_client'
import { SafeUrlFetcher, type UrlFetcher } from '#services/moderation/url/safe_url_fetcher'
import { staticFlags } from '#services/moderation/url/static_checks'
import {
  FakeWebRiskClient,
  GoogleWebRiskClient,
  type WebRiskClient,
} from '#services/moderation/url/web_risk_client'

const TTL = {
  malicious: { days: 30 },
  safe: { hours: 24 },
  unknown: { hours: 6 },
  failed: { minutes: 15 },
} as const

/** RDAP answers barely change; re-ask once a month. */
const RDAP_RECHECK = { days: 30 }

export const fakeWebRisk = new FakeWebRiskClient()
export const fakeUrlFetcher = new FakeUrlFetcher()
export const fakeRdap = new FakeRdapClient()

let webRisk: WebRiskClient | null = null
let fetcher: UrlFetcher | null = null
let rdap: RdapClient | null = null

function clients() {
  if (env.get('NODE_ENV') === 'test') {
    return { webRisk: fakeWebRisk, fetcher: fakeUrlFetcher, rdap: fakeRdap }
  }
  webRisk ??= new GoogleWebRiskClient()
  fetcher ??= new SafeUrlFetcher()
  rdap ??= new IanaRdapClient()
  return { webRisk, fetcher, rdap }
}

/** Resets the in-memory test fakes. */
export function resetUrlAnalysisFakes() {
  fakeWebRisk.reset()
  fakeUrlFetcher.reset()
  fakeRdap.reset()
}

export interface AnalyzeOptions {
  /** Re-analyse even if the cached result hasn't expired (RescanRecentUrls). */
  force?: boolean
}

/** Looks up (and caches) the registration date of a domain not on any list. */
async function refreshDomainAge(domain: string, client: RdapClient) {
  const row = await UrlDomain.findBy('domain', domain)
  if (row?.rdapCheckedAt && row.rdapCheckedAt > DateTime.now().minus(RDAP_RECHECK)) {
    return
  }
  let registeredAt: DateTime | null = null
  try {
    registeredAt = await client.registrationDate(domain)
  } catch (error) {
    logger.warn({ domain, error: String(error) }, 'RDAP lookup failed')
    return
  }
  await UrlDomain.updateOrCreate(
    { domain },
    { registeredAt: registeredAt ?? row?.registeredAt ?? null, rdapCheckedAt: DateTime.now() }
  )
}

/**
 * Analyses one URL (normalized or not) and returns its url_scans row. Never
 * throws for remote failures - those become an 'unknown' verdict that
 * expires soon.
 */
export async function analyzeUrl(rawUrl: string, options: AnalyzeOptions = {}): Promise<UrlScan> {
  const normalized = normalizeUrl(rawUrl)
  if (!normalized) {
    throw new Error(`Not a URL: ${rawUrl}`)
  }
  const existing = await UrlScan.findBy('urlHash', normalized.hash)
  if (!options.force && existing && existing.expiresAt > DateTime.now()) {
    return existing
  }

  const { webRisk: webRiskClient, fetcher: urlFetcher, rdap: rdapClient } = clients()
  const lists = await getEffectiveDomainLists()
  const list = listStatusFor(normalized.hostname, lists).status
  const flags = staticFlags(normalized, lists.allowDomains)
  const reasons: string[] = []

  // Follow redirects for shorteners and unlisted domains only: allow-listed
  // and file-hosting sites are known services, and a blocked one is decided.
  let chain = [normalized.url]
  let final = normalized
  let blockedHop: string | null = null
  const web = normalized.scheme === 'http' || normalized.scheme === 'https'
  if (web && (flags.includes('shortener') || list === 'none') && !flags.includes('private_ip')) {
    const result = await urlFetcher.resolve(normalized.url)
    chain = result.chain
    blockedHop = result.blockedHop
    if (result.error) reasons.push(`redirect_${result.error}`)
    final = normalizeUrl(result.finalUrl) ?? normalized
  }
  if (blockedHop || flags.includes('private_ip')) {
    reasons.push('redirect_blocked_address')
  }

  // Web Risk on where the link starts and where it ends up.
  const threatTypes = new Set<string>()
  let expireTime: DateTime | null = null
  let lookupFailed = false
  if (!webRiskClient.available) {
    reasons.push('web_risk_unavailable')
  } else {
    for (const url of new Set([normalized.url, final.url])) {
      try {
        const result = await webRiskClient.search(url)
        result.threatTypes.forEach((type) => threatTypes.add(type))
        if (result.expireTime && (!expireTime || result.expireTime < expireTime)) {
          expireTime = result.expireTime
        }
      } catch (error) {
        lookupFailed = true
        logger.warn({ url, error: String(error) }, 'Web Risk lookup failed')
      }
    }
    if (threatTypes.size > 0) reasons.push('web_risk')
    if (lookupFailed) reasons.push('web_risk_error')
  }

  // Domain age matters for domains nobody vouches for.
  const finalDomain = getDomain(final.hostname)
  const finalList = listStatusFor(final.hostname, lists).status
  if (finalDomain && finalList === 'none') {
    await refreshDomainAge(finalDomain, rdapClient)
  }

  const malicious = threatTypes.size > 0 || blockedHop !== null || flags.includes('private_ip')
  const unknown = !malicious && (!webRiskClient.available || lookupFailed)
  const verdict: UrlScan['verdict'] = malicious ? 'malicious' : unknown ? 'unknown' : 'safe'
  const now = DateTime.now()
  let expiresAt = now.plus(
    malicious ? TTL.malicious : lookupFailed ? TTL.failed : unknown ? TTL.unknown : TTL.safe
  )
  if (verdict === 'safe' && expireTime && expireTime < expiresAt) {
    expiresAt = expireTime
  }

  const attributes = {
    normalizedUrl: normalized.url,
    domain: normalized.hostname,
    verdict,
    threatTypes: [...threatTypes],
    finalUrl: final.url !== normalized.url ? final.url : null,
    finalDomain: final.hostname,
    redirectChain: chain,
    details: { reasons, blockedHop },
    checkedAt: now,
    expiresAt,
  }
  if (existing) {
    existing.merge(attributes)
    await existing.save()
    return existing
  }
  try {
    return await UrlScan.create({ urlHash: normalized.hash, ...attributes })
  } catch (error) {
    // A concurrent analysis of the same URL won the insert - use its row.
    const winner = await UrlScan.findBy('urlHash', normalized.hash)
    if (winner) return winner
    throw error
  }
}

export interface LinkCheck {
  /**
   * safe: reputation checked, nothing found. caution: couldn't be checked,
   * or the domain is very new - the interstitial should warn more strongly.
   * blocked: malicious, or the domain is blocked - the URL isn't returned.
   */
  verdict: 'safe' | 'caution' | 'blocked'
  url: string | null
  domain: string
}

/** Domains younger than this get a stronger warning at click time. */
const CAUTION_DOMAIN_AGE_DAYS = 30

/**
 * The link interstitial's click-time check (GET /v1/links/:token): the
 * domain lists as they are now, and a fresh analysis if the cached verdict
 * has expired - so a link taken down after a message was read can't be
 * followed from it.
 */
export async function checkLink(token: string): Promise<LinkCheck | null> {
  const link = await MessageUrl.findBy('token', token)
  if (!link) return null
  const message = await Message.find(link.messageId)
  if (!message || ['blocked', 'removed', 'withdrawn'].includes(message.status)) {
    return null
  }

  const lists = await getEffectiveDomainLists()
  const list = listStatusFor(link.domain, lists).status
  if (list === 'block') {
    return { verdict: 'blocked', url: null, domain: link.domain }
  }
  if (list === 'allow') {
    return { verdict: 'safe', url: link.normalizedUrl, domain: link.domain }
  }

  const scan = await analyzeUrl(link.normalizedUrl)
  const finalHost = scan.finalDomain ?? link.domain
  if (scan.verdict === 'malicious' || listStatusFor(finalHost, lists).status === 'block') {
    return { verdict: 'blocked', url: null, domain: link.domain }
  }
  const domain = getDomain(finalHost)
  const row = domain ? await UrlDomain.findBy('domain', domain) : null
  const young =
    row?.registeredAt &&
    DateTime.now().diff(row.registeredAt, 'days').days < CAUTION_DOMAIN_AGE_DAYS
  return {
    verdict: scan.verdict === 'unknown' || young ? 'caution' : 'safe',
    url: link.normalizedUrl,
    domain: link.domain,
  }
}

/**
 * Bumps url_domains' "seen" stats for the registrable domains in a message.
 * Best-effort bookkeeping after a send - never fails the send.
 */
export async function recordDomainsSeen(hostnames: string[]) {
  const domains = [
    ...new Set(hostnames.map((host) => getDomain(host)).filter((d): d is string => d !== null)),
  ]
  if (domains.length === 0) return
  const now = DateTime.now().toSQL()!
  try {
    for (const domain of domains) {
      await db
        .table('url_domains')
        .insert({
          domain,
          first_seen_at: now,
          last_seen_at: now,
          seen_count: 1,
          created_at: now,
          updated_at: now,
        })
        .onConflict('domain')
        .merge({
          last_seen_at: now,
          updated_at: now,
          seen_count: db.raw('url_domains.seen_count + 1'),
          first_seen_at: db.raw('coalesce(url_domains.first_seen_at, ?)', [now]),
        })
    }
  } catch (error) {
    logger.warn({ error: String(error) }, 'Failed to record seen domains')
  }
}
