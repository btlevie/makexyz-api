/**
 * Checks on a link's shape alone - no network, no database. They run at send
 * time on every link, so a message pointing at 127.0.0.1 or "paypa1.com" is
 * blocked before it's stored, never mind delivered.
 */
import { remove as removeConfusables } from 'confusables'
import { getDomain } from 'tldts'
import {
  ARCHIVE_EXTENSIONS,
  DANGEROUS_EXTENSIONS,
  HIGH_ABUSE_TLDS,
  IMPERSONATED_BRANDS,
  SHORTENERS,
} from '#services/moderation/url/domain_lists'
import { isBlockedAddress } from '#services/moderation/url/ip_policy'
import type { NormalizedUrl } from '#services/moderation/url/normalize'

export type UrlFlag =
  /** Host is an IP address. */
  | 'ip_literal'
  /** ...a private, loopback, link-local or metadata one. */
  | 'private_ip'
  /** `user:pass@host` - hides the real host behind a familiar-looking prefix. */
  | 'userinfo'
  /** Not http/https (javascript:, data:, file:, ftp:...). */
  | 'bad_scheme'
  /** A port other than 80/443. */
  | 'non_standard_port'
  /** Looks like a well-known brand or an allow-listed domain without being it. */
  | 'lookalike'
  /** Non-Latin characters in the host (IDN). */
  | 'idn'
  /** Five or more labels in front of the registrable domain. */
  | 'deep_subdomain'
  | 'high_abuse_tld'
  /** A link shortener - the destination is hidden until the redirect is followed. */
  | 'shortener'
  /** The path ends in an executable/installer. */
  | 'dangerous_extension'
  /** The path ends in an archive. */
  | 'archive_extension'

/** Anything outside ASCII - the only characters handed to the confusables map. */
const NON_ASCII = /\P{ASCII}/gu

/** The characters people swap to imitate others ("paypa1", "rnicrosoft"). */
const SKELETON_SWAPS: [RegExp, string][] = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/[1i|]/g, 'l'],
  [/0/g, 'o'],
]

/**
 * A domain name's visual skeleton: look-alike characters folded to Latin
 * (Cyrillic "а" -> "a"), then the common ASCII swaps undone. Two names with
 * the same skeleton look the same to a hurried reader.
 */
export function skeleton(label: string): string {
  // Only non-ASCII goes through the confusables map, as in normalizer.ts.
  let folded = label
    .normalize('NFKC')
    .replace(NON_ASCII, (character) => removeConfusables(character))
    .toLowerCase()
  for (const [pattern, replacement] of SKELETON_SWAPS) {
    folded = folded.replace(pattern, replacement)
  }
  return folded
}

/** The registrable domain without its public suffix: "paypal" from "paypal.co.uk". */
function nameOf(registrableDomain: string): string {
  return registrableDomain.split('.')[0]
}

/** Skeleton -> the real names that have it, for brands and allow-listed domains. */
function protectedSkeletons(allowDomains: Iterable<string>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const add = (name: string) => {
    const key = skeleton(name)
    if (!map.has(key)) map.set(key, new Set())
    map.get(key)!.add(name)
  }
  IMPERSONATED_BRANDS.forEach(add)
  for (const domain of allowDomains) add(nameOf(getDomain(domain) ?? domain))
  return map
}

const brandSkeletonCache = new Map<string, Map<string, Set<string>>>()

/**
 * Whether a host imitates a protected name: its name has the same skeleton as
 * a brand/allow-listed name but isn't spelled the same. An exact name on a
 * different TLD (dhl.de) is a country site, not an imitation.
 */
export function isLookalike(url: NormalizedUrl, allowDomains: string[]): boolean {
  if (!url.registrableDomain) {
    return false
  }
  const cacheKey = allowDomains.join(',')
  let skeletons = brandSkeletonCache.get(cacheKey)
  if (!skeletons) {
    brandSkeletonCache.clear()
    skeletons = protectedSkeletons(allowDomains)
    brandSkeletonCache.set(cacheKey, skeletons)
  }

  // Compare the human-readable form - punycode would hide a Cyrillic "а".
  const unicodeDomain = url.unicodeHostname
    .split('.')
    .slice(-url.registrableDomain.split('.').length)
    .join('.')
  const name = nameOf(unicodeDomain)
  const matches = skeletons.get(skeleton(name))
  return matches !== undefined && !matches.has(name)
}

/** The last path segment's extension, lowercased ("setup.EXE" -> "exe"). */
function pathExtension(pathname: string): string | null {
  const last = pathname.split('/').pop() ?? ''
  const dot = last.lastIndexOf('.')
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : null
}

export function staticFlags(url: NormalizedUrl, allowDomains: string[]): UrlFlag[] {
  const flags: UrlFlag[] = []

  if (url.ip) {
    flags.push('ip_literal')
    if (isBlockedAddress(url.ip.address)) flags.push('private_ip')
  }
  if (url.hadUserinfo) flags.push('userinfo')
  if (url.scheme !== 'http' && url.scheme !== 'https') flags.push('bad_scheme')
  if (url.port !== null && url.port !== 80 && url.port !== 443) flags.push('non_standard_port')

  if (!url.ip) {
    if (isLookalike(url, allowDomains)) flags.push('lookalike')
    if (url.unicodeHostname !== url.hostname) flags.push('idn')
    const subdomainLabels =
      url.registrableDomain === null
        ? 0
        : url.hostname.split('.').length - url.registrableDomain.split('.').length
    if (subdomainLabels >= 5) flags.push('deep_subdomain')
    const tld = url.hostname.split('.').pop() ?? ''
    if (HIGH_ABUSE_TLDS.has(tld)) flags.push('high_abuse_tld')
    if (
      SHORTENERS.has(url.hostname) ||
      (url.registrableDomain && SHORTENERS.has(url.registrableDomain))
    ) {
      flags.push('shortener')
    }
  }

  const extension = pathExtension(url.pathname)
  if (extension && DANGEROUS_EXTENSIONS.has(extension)) flags.push('dangerous_extension')
  if (extension && ARCHIVE_EXTENSIONS.has(extension)) flags.push('archive_extension')

  return flags
}
