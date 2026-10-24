/**
 * The read side of URL reputation, on the send path: fresh url_scans rows
 * for a message's links, as the rules see them. Two indexed queries, no
 * network - the analysis itself happens in AnalyzeMessage
 * (url_analysis_service.ts).
 */
import { DateTime } from 'luxon'
import { getDomain } from 'tldts'
import UrlDomain from '#models/url_domain'
import UrlScan from '#models/url_scan'
import { listStatusFor, type EffectiveDomainLists } from '#services/moderation/url/domain_registry'
import type { ExtractedUrl, UrlScanSummary } from '#services/moderation/types'

export function summarizeScan(
  scan: UrlScan,
  lists: EffectiveDomainLists,
  registeredAt: DateTime | null
): UrlScanSummary {
  const finalHostname =
    scan.finalDomain && scan.finalDomain !== scan.domain ? scan.finalDomain : null
  return {
    verdict: scan.verdict,
    threatTypes: scan.threatTypes ?? [],
    finalHostname,
    finalList: finalHostname ? listStatusFor(finalHostname, lists).status : null,
    domainAgeDays: registeredAt ? Math.floor(DateTime.now().diff(registeredAt, 'days').days) : null,
    reasons: Array.isArray(scan.details?.reasons) ? (scan.details.reasons as string[]) : [],
  }
}

/** Fresh scans for these links, keyed by URL hash. Expired or missing ones are absent. */
export async function lookupScans(
  urls: ExtractedUrl[],
  lists: EffectiveDomainLists
): Promise<Map<string, UrlScanSummary>> {
  const result = new Map<string, UrlScanSummary>()
  if (urls.length === 0) {
    return result
  }

  const scans = await UrlScan.query()
    .whereIn(
      'urlHash',
      urls.map((url) => url.hash)
    )
    .where('expiresAt', '>', DateTime.now().toSQL()!)
  if (scans.length === 0) {
    return result
  }

  const domains = [
    ...new Set(
      scans
        .map((scan) => getDomain(scan.finalDomain ?? scan.domain))
        .filter((domain): domain is string => domain !== null)
    ),
  ]
  const aged = await UrlDomain.query().whereIn('domain', domains).whereNotNull('registeredAt')
  const ages = new Map(aged.map((row) => [row.domain, row.registeredAt]))

  for (const scan of scans) {
    const domain = getDomain(scan.finalDomain ?? scan.domain)
    result.set(scan.urlHash, summarizeScan(scan, lists, (domain && ages.get(domain)) || null))
  }
  return result
}
