/**
 * Google Web Risk (Lookup API, `uris.search`): malware, phishing and
 * unwanted-software verdicts for a URL. Only the URL is sent. The key goes in
 * a header rather than the query string so it never appears in request logs.
 * Free up to 100K lookups a month; url_scans caching keeps us far below that.
 */
import { DateTime } from 'luxon'
import env from '#start/env'

const ENDPOINT = 'https://webrisk.googleapis.com/v1/uris:search'
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE']
const TIMEOUT_MS = 3000

export interface WebRiskResult {
  threatTypes: string[]
  /** How long Google says the result holds. */
  expireTime: DateTime | null
}

export interface WebRiskClient {
  /** False when no API key is configured - every link's reputation is then unknown. */
  readonly available: boolean
  search(url: string): Promise<WebRiskResult>
}

export class GoogleWebRiskClient implements WebRiskClient {
  constructor(private readonly apiKey: string | undefined = env.get('WEB_RISK_API_KEY')) {}

  get available() {
    return Boolean(this.apiKey)
  }

  async search(url: string): Promise<WebRiskResult> {
    if (!this.apiKey) {
      throw new Error('WEB_RISK_API_KEY is not configured')
    }
    const query = new URLSearchParams({ uri: url })
    for (const type of THREAT_TYPES) query.append('threatTypes', type)

    const response = await fetch(`${ENDPOINT}?${query}`, {
      headers: { 'X-Goog-Api-Key': this.apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Web Risk returned ${response.status}`)
    }
    const body = (await response.json()) as {
      threat?: { threatTypes?: string[]; expireTime?: string }
    }
    return {
      threatTypes: body.threat?.threatTypes ?? [],
      expireTime: body.threat?.expireTime ? DateTime.fromISO(body.threat.expireTime) : null,
    }
  }
}

/** In-memory stand-in for tests: URLs are clean unless marked. */
export class FakeWebRiskClient implements WebRiskClient {
  available = true
  failing = false
  readonly threats = new Map<string, string[]>()
  readonly searched: string[] = []

  async search(url: string): Promise<WebRiskResult> {
    this.searched.push(url)
    if (this.failing) {
      throw new Error('Web Risk unavailable (fake)')
    }
    return { threatTypes: this.threats.get(url) ?? [], expireTime: null }
  }

  reset() {
    this.available = true
    this.failing = false
    this.threats.clear()
    this.searched.length = 0
  }
}
