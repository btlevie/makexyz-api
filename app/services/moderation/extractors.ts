/**
 * Extractors turn a message's text views into typed signals. They decide
 * nothing - rules do - so a new rule can reuse them without re-parsing.
 *
 * Structured things only - emails, phones, URLs, handles, payment
 * identifiers, digit runs, profanity. Phrase lists ("pay me directly",
 * platform names, prohibited items) belong to the rule that uses them (see
 * rules/ and lexicon.ts), so adding a rule never means editing this file.
 */
import { LinkifyIt } from 'linkify-it'
import { findPhoneNumbersInText } from 'libphonenumber-js/max'
import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from 'obscenity'
import { getDomain, parse } from 'tldts'
import { isAllowlistedDomain } from '#services/moderation/allowlist'
import {
  isValidAbaRouting,
  isValidBase58Check,
  isValidBech32,
  isValidIban,
} from '#services/moderation/checksums'
import type {
  ExtractedBankDetail,
  ExtractedCryptoAddress,
  ExtractedDigitRun,
  ExtractedEmail,
  ExtractedHandle,
  ExtractedPhone,
  ExtractedUrl,
  ProfanitySignal,
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
  // `numeric` catches spelled-out and spaced-out digits ("four one five ...").
  for (const view of ['normalized', 'deobfuscated', 'numeric'] as const) {
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

/** `@name`, not preceded by a word character (so never the middle of an email). */
const HANDLE_PATTERN = /(?<![\w.@])@([a-z0-9_](?:[a-z0-9_.]{1,28}[a-z0-9_])?)(?![\w@])/g

export function extractHandles(views: TextViews): ExtractedHandle[] {
  const found = new Set<string>()
  for (const match of views.deobfuscated.matchAll(HANDLE_PATTERN)) {
    found.add(match[1])
  }
  return [...found].map((handle) => ({ handle }))
}

const BTC_LEGACY = /\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b/g
const BTC_BECH32 = /\bbc1[02-9ac-hj-np-z]{11,71}\b/gi
const ETH = /\b0x[0-9a-fA-F]{40}\b/g
const TRON = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g

/**
 * Checksum-valid crypto addresses. Read from `raw` with whitespace removed,
 * since base58 is case-sensitive and people split addresses across lines.
 * Ethereum addresses have no checksum without mixed case, so the 40-hex-digit
 * shape is taken as is.
 */
export function extractCryptoAddresses(views: TextViews): ExtractedCryptoAddress[] {
  const found = new Map<string, ExtractedCryptoAddress>()
  const text = views.raw.normalize('NFKC')
  const add = (kind: ExtractedCryptoAddress['kind'], address: string) => {
    if (!found.has(address)) found.set(address, { kind, address })
  }
  for (const [match] of text.matchAll(BTC_LEGACY)) {
    if (isValidBase58Check(match)) add('btc', match)
  }
  for (const [match] of text.matchAll(BTC_BECH32)) {
    if (isValidBech32(match)) add('btc', match)
  }
  for (const [match] of text.matchAll(ETH)) {
    add('eth', match)
  }
  for (const [match] of text.matchAll(TRON)) {
    if (isValidBase58Check(match)) add('tron', match)
  }
  return [...found.values()]
}

/** Two letters, two digits, then 11-30 letters/digits, optionally in groups of four. */
const IBAN_PATTERN = /\b[a-z]{2}\d{2}(?:[ ]?[a-z0-9]{4}){2,7}(?:[ ]?[a-z0-9]{1,4})?\b/gi
const SWIFT_PATTERN = /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g
const ROUTING_PATTERN = /\b\d{9}\b/g
/** Banking words that make a 9-digit checksum match (or a SWIFT-shaped code) count. */
const BANKING_CONTEXT = /\b(?:routing|aba|account|acct|swift|bic|bank|wire)\b/i

export function extractBankDetails(views: TextViews): ExtractedBankDetail[] {
  const found = new Map<string, ExtractedBankDetail>()
  const text = views.raw.normalize('NFKC')
  for (const [match] of text.matchAll(IBAN_PATTERN)) {
    if (isValidIban(match)) {
      found.set(match, { kind: 'iban', value: match.replace(/\s+/g, '').toUpperCase() })
    }
  }
  if (BANKING_CONTEXT.test(text)) {
    for (const [match] of views.numeric.matchAll(ROUTING_PATTERN)) {
      if (isValidAbaRouting(match)) found.set(match, { kind: 'routing_number', value: match })
    }
    for (const [match] of text.matchAll(SWIFT_PATTERN)) {
      found.set(match, { kind: 'swift_bic', value: match })
    }
  }
  return [...found.values()]
}

/** Words that make a long number something other than a phone number. */
const NON_PHONE_CONTEXT =
  /(?:\b(?:order|ord|tracking|track|ups|usps|fedex|dhl|invoice|part|sku|serial|qty|po)\b|#|mm\b|\bx\b)/i
const DIGIT_RUN = /(?<!\d)\d{10,15}(?!\d)/g

/**
 * Long digit runs that might be a phone number written to dodge the phone
 * rule ("4 1 5 5 5 5 2 6 7 1", "four one five..."), once separators and
 * number words are folded. Runs near order/tracking/dimension words are
 * skipped - those are the legitimate long numbers in these conversations.
 */
export function extractDigitRuns(views: TextViews, phones: ExtractedPhone[]): ExtractedDigitRun[] {
  if (NON_PHONE_CONTEXT.test(views.normalized)) {
    return []
  }
  const phoneDigits = phones.map((phone) => phone.number.replace(/\D/g, ''))
  const found = new Set<string>()
  for (const [digits] of views.numeric.matchAll(DIGIT_RUN)) {
    if (!phoneDigits.some((phone) => phone.endsWith(digits) || digits.endsWith(phone.slice(-10)))) {
      found.add(digits)
    }
  }
  return [...found].map((digits) => ({ digits }))
}

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})
const SECOND_PERSON = /\b(?:you|your|you're|youre|ur|u)\b/g
/** How close (in characters) profanity must be to "you" to count as aimed at the reader. */
const DIRECTED_DISTANCE = 25

export function extractProfanity(views: TextViews): ProfanitySignal {
  const matches = profanityMatcher.getAllMatches(views.normalized, true)
  if (matches.length === 0) {
    return { count: 0, directed: false, terms: [] }
  }
  const secondPerson = [...views.normalized.matchAll(SECOND_PERSON)].map((match) => match.index)
  const directed = matches.some((match) =>
    secondPerson.some(
      (index) =>
        Math.abs(index - match.startIndex) <= DIRECTED_DISTANCE ||
        Math.abs(index - match.endIndex) <= DIRECTED_DISTANCE
    )
  )
  const terms = matches.map((match) => views.normalized.slice(match.startIndex, match.endIndex + 1))
  return { count: matches.length, directed, terms: [...new Set(terms)] }
}

export function extractSignals(views: TextViews): Signals {
  const phones = extractPhones(views)
  return {
    emails: extractEmails(views),
    phones,
    urls: extractUrls(views),
    handles: extractHandles(views),
    cryptoAddresses: extractCryptoAddresses(views),
    bankDetails: extractBankDetails(views),
    digitRuns: extractDigitRuns(views, phones),
    profanity: extractProfanity(views),
  }
}
