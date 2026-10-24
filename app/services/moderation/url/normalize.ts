/**
 * One canonical form per link, so the same URL written different ways
 * ("HTTP://Example.com:80/a//b?utm_source=x#top", "example.com/a/b") shares
 * one reputation lookup and one cache entry. The WHATWG URL parser does the
 * heavy lifting: IDNA to punycode, IPv4 in decimal/octal/hex
 * ("http://0x7f.1", "http://2130706433") to dotted form, dot-segments,
 * default ports.
 */
import { createHash } from 'node:crypto'
import { domainToUnicode } from 'node:url'
import { getDomain } from 'tldts'

export interface NormalizedUrl {
  /** The canonical URL string - what's looked up, cached and linked to. */
  url: string
  /** sha256 of `url`: the url_scans / message_urls key. */
  hash: string
  scheme: string
  /** ASCII (punycode) host, no brackets or trailing dot. */
  hostname: string
  /** The host as people read it ("xn--80ak6aa92e.com" -> "аррӏе.com"). */
  unicodeHostname: string
  /** eTLD+1 (example.co.uk), or null for IPs/unknown suffixes. */
  registrableDomain: string | null
  /** Set when the host is an IP literal. */
  ip: { version: 4 | 6; address: string } | null
  port: number | null
  pathname: string
  /** The link had `user:pass@` in it (stripped from `url`) - a phishing tell. */
  hadUserinfo: boolean
}

/** Query parameters that only track clicks - dropping them doesn't change the page. */
const TRACKING_PARAM =
  /^(?:utm_.+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi)$/i

/** Characters RFC 3986 says never need percent-encoding. */
const UNRESERVED = /[A-Za-z0-9\-._~]/

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

function decodeUnreserved(component: string): string {
  return component.replace(/%([0-9a-f]{2})/gi, (escape, hex: string) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16))
    return UNRESERVED.test(character) ? character : escape.toUpperCase()
  })
}

export function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

/**
 * Normalizes a link as found in text ("example.shop/deal" gets http://).
 * Returns null for anything the URL parser rejects.
 */
export function normalizeUrl(input: string): NormalizedUrl | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  const withScheme =
    SCHEME.test(trimmed) && !/^[a-z0-9.-]+:\d/i.test(trimmed)
      ? trimmed
      : `http://${trimmed.replace(/^\/\//, '')}`

  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
  const hadUserinfo = parsed.username !== '' || parsed.password !== ''
  parsed.username = ''
  parsed.password = ''
  parsed.hash = ''

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (parsed.hostname.endsWith('.')) {
    parsed.hostname = hostname
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) {
      parsed.searchParams.delete(key)
    }
  }

  if (scheme === 'http' || scheme === 'https') {
    parsed.pathname = decodeUnreserved(parsed.pathname.replace(/\/{2,}/g, '/'))
  }

  let url = parsed.toString()
  // A bare "?" left behind once every tracking parameter is gone.
  if (parsed.search === '' && url.endsWith('?')) {
    url = url.slice(0, -1)
  }

  const ipVersion = parsed.hostname.startsWith('[') ? 6 : IPV4.test(hostname) ? 4 : null
  const ip = ipVersion ? { version: ipVersion as 4 | 6, address: hostname } : null

  return {
    url,
    hash: hashUrl(url),
    scheme,
    hostname,
    unicodeHostname: ip ? hostname : domainToUnicode(hostname) || hostname,
    registrableDomain: ip ? null : getDomain(hostname),
    ip,
    port: parsed.port ? Number(parsed.port) : null,
    pathname: parsed.pathname,
    hadUserinfo,
  }
}
