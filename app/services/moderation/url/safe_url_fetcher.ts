/**
 * Follows a link's redirects to see where it really goes - the one place the
 * app makes requests to attacker-chosen URLs, so it's built to be useless as
 * an SSRF tool (docs/plans/messaging_moderation.md, section 2a step 7):
 *
 * - DNS is resolved by us, and every address the name resolves to is checked
 *   against ip_policy.ts before connecting. The connection then uses exactly
 *   those checked addresses (Node's `lookup` hook), so a DNS answer that
 *   changes between check and connect (rebinding) can't slip through.
 * - IP-literal hosts are checked directly (Node skips `lookup` for them).
 * - Only http/https on ports 80/443; every redirect hop is re-checked.
 * - HEAD first, GET with a byte range only when needed (405/501, or an HTML
 *   page that might carry a <meta refresh>); at most 5 hops, 3s per hop, 8s
 *   in total, 256 KB of body. No cookies, no JavaScript, a fixed user agent.
 * - A hop pointing into a private network is reported, not just refused -
 *   it's a malicious verdict for the link.
 *
 * It runs in the queue worker for now, behind the UrlFetcher interface, so it
 * can move to a Lambda with no IAM role and no VPC access without callers
 * changing.
 */
import http from 'node:http'
import https from 'node:https'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { isIP } from 'node:net'
import { isBlockedAddress } from '#services/moderation/url/ip_policy'

export interface RedirectResult {
  /** Every URL visited, starting with the original. */
  chain: string[]
  /** Where the redirects stopped (the last URL in `chain`). */
  finalUrl: string
  /** A hop that pointed at a forbidden address, scheme or port - the link is malicious. */
  blockedHop: string | null
  /** Why resolution stopped early: 'timeout', 'too_many_redirects', 'network'... */
  error: string | null
}

export interface UrlFetcher {
  resolve(url: string): Promise<RedirectResult>
}

export type LookupAll = (hostname: string) => Promise<LookupAddress[]>

export interface SafeUrlFetcherOptions {
  /** DNS resolution - injectable for tests. Defaults to the system resolver. */
  lookupAll?: LookupAll
  /** Address policy - injectable for tests against a local server. */
  isAllowedAddress?: (address: string) => boolean
  allowedPorts?: number[]
  maxHops?: number
  hopTimeoutMs?: number
  totalTimeoutMs?: number
  maxBodyBytes?: number
}

const USER_AGENT = 'MakeXYZ-LinkCheck/1.0 (+https://makexyz.com)'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** <meta http-equiv="refresh" content="0; url=https://..."> */
const META_REFRESH =
  /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\s*\d*\s*;?\s*url\s*=\s*([^"'>\s]+)/i

class BlockedHopError extends Error {
  constructor(readonly url: string) {
    super(`Blocked hop: ${url}`)
  }
}

function systemLookupAll(hostname: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses)
    )
  })
}

interface HopResponse {
  status: number
  location: string | null
  contentType: string
  body: string
}

export class SafeUrlFetcher implements UrlFetcher {
  private readonly lookupAll: LookupAll
  private readonly isAllowedAddress: (address: string) => boolean
  private readonly allowedPorts: number[]
  private readonly maxHops: number
  private readonly hopTimeoutMs: number
  private readonly totalTimeoutMs: number
  private readonly maxBodyBytes: number

  constructor(options: SafeUrlFetcherOptions = {}) {
    this.lookupAll = options.lookupAll ?? systemLookupAll
    this.isAllowedAddress = options.isAllowedAddress ?? ((address) => !isBlockedAddress(address))
    this.allowedPorts = options.allowedPorts ?? [80, 443]
    this.maxHops = options.maxHops ?? 5
    this.hopTimeoutMs = options.hopTimeoutMs ?? 3000
    this.totalTimeoutMs = options.totalTimeoutMs ?? 8000
    this.maxBodyBytes = options.maxBodyBytes ?? 256 * 1024
  }

  async resolve(url: string): Promise<RedirectResult> {
    const chain: string[] = [url]
    const deadline = Date.now() + this.totalTimeoutMs
    let current = url

    try {
      for (let hop = 0; hop <= this.maxHops; hop++) {
        const target = this.checkTarget(current)
        const next = await this.followOnce(target, deadline)
        if (!next) {
          return { chain, finalUrl: current, blockedHop: null, error: null }
        }
        if (hop === this.maxHops) {
          return { chain, finalUrl: current, blockedHop: null, error: 'too_many_redirects' }
        }
        current = next
        chain.push(current)
      }
      return { chain, finalUrl: current, blockedHop: null, error: 'too_many_redirects' }
    } catch (error) {
      if (error instanceof BlockedHopError) {
        return { chain, finalUrl: current, blockedHop: error.url, error: null }
      }
      const code = (error as { code?: string }).code
      const timedOut = code === 'ETIMEDOUT' || (error as Error).name === 'TimeoutError'
      return { chain, finalUrl: current, blockedHop: null, error: timedOut ? 'timeout' : 'network' }
    }
  }

  /** Scheme, port and (for IP literals) address checks - before any connection. */
  private checkTarget(url: string): URL {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new BlockedHopError(url)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BlockedHopError(url)
    }
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
    if (!this.allowedPorts.includes(port)) {
      throw new BlockedHopError(url)
    }
    if (parsed.username || parsed.password) {
      throw new BlockedHopError(url)
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) && !this.isAllowedAddress(host)) {
      throw new BlockedHopError(url)
    }
    return parsed
  }

  /** One request; returns the next URL to visit, or null when this is where it ends. */
  private async followOnce(target: URL, deadline: number): Promise<string | null> {
    let response = await this.request(target, 'HEAD', deadline)
    if (response.status === 405 || response.status === 501) {
      response = await this.request(target, 'GET', deadline)
    }
    if (REDIRECT_STATUSES.has(response.status) && response.location) {
      return new URL(response.location, target).toString()
    }
    if (
      response.status >= 200 &&
      response.status < 300 &&
      response.contentType.includes('text/html')
    ) {
      const page = response.body ? response : await this.request(target, 'GET', deadline)
      const refresh = page.body.match(META_REFRESH)
      if (refresh) {
        return new URL(refresh[1], target).toString()
      }
    }
    return null
  }

  private request(target: URL, method: 'HEAD' | 'GET', deadline: number): Promise<HopResponse> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return Promise.reject(Object.assign(new Error('Deadline exceeded'), { code: 'ETIMEDOUT' }))
    }
    const transport = target.protocol === 'https:' ? https : http
    const timeout = Math.min(this.hopTimeoutMs, remaining)

    return new Promise<HopResponse>((resolve, reject) => {
      const request = transport.request(
        target,
        {
          method,
          agent: false,
          headers: {
            'user-agent': USER_AGENT,
            'accept': 'text/html,*/*;q=0.5',
            ...(method === 'GET' ? { range: `bytes=0-${this.maxBodyBytes - 1}` } : {}),
          },
          // The SSRF guard: resolve, check every address, connect only to those.
          lookup: (hostname, options, callback) => {
            this.lookupAll(hostname)
              .then((addresses) => {
                if (
                  addresses.length === 0 ||
                  addresses.some((a) => !this.isAllowedAddress(a.address))
                ) {
                  callback(new BlockedHopError(target.toString()), '', 0)
                  return
                }
                if ((options as { all?: boolean }).all) {
                  ;(callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses)
                } else {
                  callback(null, addresses[0].address, addresses[0].family)
                }
              })
              .catch((error) => callback(error, '', 0))
          },
          timeout,
          signal: AbortSignal.timeout(remaining),
        },
        (response) => {
          const location = response.headers.location ?? null
          const contentType = String(response.headers['content-type'] ?? '')
          if (method === 'HEAD' || !contentType.includes('text/html')) {
            response.destroy()
            resolve({ status: response.statusCode ?? 0, location, contentType, body: '' })
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            chunks.push(chunk)
            if (size >= this.maxBodyBytes) response.destroy()
          })
          const finish = () =>
            resolve({
              status: response.statusCode ?? 0,
              location,
              contentType,
              body: Buffer.concat(chunks).subarray(0, this.maxBodyBytes).toString('utf8'),
            })
          response.on('end', finish)
          response.on('close', finish)
          response.on('error', finish)
        }
      )
      request.on('timeout', () =>
        request.destroy(Object.assign(new Error('Hop timed out'), { code: 'ETIMEDOUT' }))
      )
      request.on('error', (error) => {
        // The lookup hook's BlockedHopError surfaces here, wrapped or not.
        const cause = (error as { cause?: unknown }).cause
        reject(
          error instanceof BlockedHopError
            ? error
            : cause instanceof BlockedHopError
              ? cause
              : error
        )
      })
      request.end()
    })
  }
}
