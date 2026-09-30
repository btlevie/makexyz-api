/**
 * Extractors turn a message's text views into typed signals. They decide
 * nothing - rules do - so a new rule can reuse them without re-parsing.
 *
 * This is the Step 1 set (emails, phones, URLs). Handles, platform names,
 * payment terms, crypto addresses and fingerprints arrive with the full
 * deterministic rule set (docs/plans/messaging_moderation.md, Step 2).
 */
import { LinkifyIt } from 'linkify-it'
import { findPhoneNumbersInText } from 'libphonenumber-js/max'
import { getDomain, parse } from 'tldts'
import { isAllowlistedDomain } from '#services/moderation/allowlist'
import type {
  ExtractedEmail,
  ExtractedPhone,
  ExtractedUrl,
  Signals,
  TextViews,
  ViewName,
} from '#services/moderation/types'

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/g

/**
 * Views in strictness order: an email found in `normalized` is plain; one
 * that only appears once brackets are undone is obfuscated; one that needs
 * the loose " at " rewrite might just be English ("look at example.com").
 */
const EMAIL_VIEWS: ViewName[] = ['normalized', 'deobfuscated', 'deobfuscatedLoose']

export function extractEmails(views: TextViews): ExtractedEmail[] {
  const found = new Map<string, ExtractedEmail>()
  for (const view of EMAIL_VIEWS) {
    for (const match of views[view].matchAll(EMAIL_PATTERN)) {
      const address = match[0].replace(/^[._%+-]+|[._%+-]+$/g, '')
      const domain = address.split('@')[1] ?? ''
      // A real public suffix, so "part@2x.png" or "v1@rev.b" aren't emails.
      if (!parse(domain).isIcann || found.has(address)) {
        continue
      }
      found.set(address, { address, view })
    }
  }
  return [...found.values()]
}

/**
 * Valid phone numbers, using libphonenumber's full metadata (not just length
 * checks). Numbers without a country code are read as US numbers. Order
 * numbers, dimensions and tracking numbers don't validate as phones, which
 * is why this only reports real numbers - fuzzier digit-run detection is a
 * Step 2 rule with its own context exclusions.
 */
export function extractPhones(views: TextViews): ExtractedPhone[] {
  const found = new Map<string, ExtractedPhone>()
  for (const view of ['normalized', 'deobfuscated'] as const) {
    for (const hit of findPhoneNumbersInText(views[view], { defaultCountry: 'US' })) {
      if (!hit.number.isValid()) {
        continue
      }
      const number = hit.number.number
      if (!found.has(number)) {
        found.set(number, { number, match: views[view].slice(hit.startsAt, hit.endsAt) })
      }
    }
  }
  return [...found.values()]
}

const linkify = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false, fuzzyIP: true })

/** Hostname of a linkify match, IDN-encoded (punycode) by the URL parser. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`).hostname
  } catch {
    return null
  }
}

/**
 * Bare domains ("myshop.xyz"), checked against the full public suffix list.
 * linkify's fuzzy matching only knows a short TLD list, so newer or cheap
 * TLDs - exactly the ones spam likes - would otherwise slip through.
 */
const BARE_DOMAIN_PATTERN =
  /(?<![@\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?![\w-])/g

/**
 * Real TLDs that are also common file extensions. A bare "bracket.zip" in a
 * message is almost always a file name, so these only count as links with a
 * scheme, a www. prefix, or a path.
 */
const FILE_EXTENSION_TLDS = new Set(['zip', 'mov', 'app', 'py', 'sh', 'md', 'rs', 'pl'])

/** URLs, including scheme-less ones ("example.shop/deal") and defanged ones. */
export function extractUrls(views: TextViews): ExtractedUrl[] {
  const found = new Map<string, ExtractedUrl>()
  const add = (key: string, match: string, hostname: string) => {
    const registrableDomain = getDomain(hostname)
    if (found.has(key) || [...found.values()].some((url) => url.hostname === hostname)) {
      return
    }
    found.set(key, {
      match,
      hostname,
      registrableDomain,
      allowlisted: isAllowlistedDomain(registrableDomain),
    })
  }

  for (const match of linkify.match(views.deobfuscated) ?? []) {
    if (match.schema === 'mailto:') {
      continue
    }
    const hostname = hostnameOf(match.url)
    if (hostname) {
      add(match.url, match.raw, hostname)
    }
  }

  for (const match of views.deobfuscated.matchAll(BARE_DOMAIN_PATTERN)) {
    const hostname = match[0]
    const parsed = parse(hostname)
    if (!parsed.isIcann || !parsed.domain) {
      continue
    }
    const followedByPath = views.deobfuscated[match.index + hostname.length] === '/'
    if (
      FILE_EXTENSION_TLDS.has(parsed.publicSuffix ?? '') &&
      !hostname.startsWith('www.') &&
      !followedByPath
    ) {
      continue
    }
    add(hostname, hostname, hostname)
  }

  return [...found.values()]
}

export function extractSignals(views: TextViews): Signals {
  return {
    emails: extractEmails(views),
    phones: extractPhones(views),
    urls: extractUrls(views),
  }
}
