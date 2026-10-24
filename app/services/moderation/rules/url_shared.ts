import type { DomainListStatus } from '#services/moderation/url/domain_lists'
import type { Evidence, ExtractedUrl } from '#services/moderation/types'

/**
 * The list that counts for a link: where it ends up once redirects are
 * followed (a shortener to Drive is user content), else its own.
 */
export function effectiveList(url: ExtractedUrl): DomainListStatus {
  return url.scan?.finalList ?? url.list
}

export function urlEvidence(urls: ExtractedUrl[]): Evidence[] {
  return urls.map((url) => ({ view: 'deobfuscated' as const, match: url.match }))
}
