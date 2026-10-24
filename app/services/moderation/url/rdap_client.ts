/**
 * Domain registration dates over RDAP (the standard, free successor to
 * WHOIS). IANA's bootstrap file says which registry answers for each TLD;
 * it's fetched once a day and kept in memory. Some ccTLDs have no RDAP
 * service - those just return null (age unknown).
 */
import { DateTime } from 'luxon'

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json'
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 4000

export interface RdapClient {
  /** When the domain was registered, or null when the registry doesn't say. */
  registrationDate(domain: string): Promise<DateTime | null>
}

interface Bootstrap {
  services: [string[], string[]][]
}

export class IanaRdapClient implements RdapClient {
  private bootstrap: { expiresAt: number; servers: Map<string, string> } | null = null

  private async serverFor(tld: string): Promise<string | null> {
    if (!this.bootstrap || this.bootstrap.expiresAt < Date.now()) {
      const response = await fetch(BOOTSTRAP_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) {
        throw new Error(`RDAP bootstrap returned ${response.status}`)
      }
      const body = (await response.json()) as Bootstrap
      const servers = new Map<string, string>()
      for (const [tlds, urls] of body.services) {
        const base = urls.find((url) => url.startsWith('https://')) ?? urls[0]
        for (const entry of tlds) servers.set(entry.toLowerCase(), base)
      }
      this.bootstrap = { expiresAt: Date.now() + BOOTSTRAP_TTL_MS, servers }
    }
    return this.bootstrap.servers.get(tld) ?? null
  }

  async registrationDate(domain: string): Promise<DateTime | null> {
    const tld = domain.split('.').pop()!.toLowerCase()
    const base = await this.serverFor(tld)
    if (!base) {
      return null
    }
    const response = await fetch(
      `${base.replace(/\/?$/, '/')}domain/${encodeURIComponent(domain)}`,
      {
        headers: { accept: 'application/rdap+json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`RDAP returned ${response.status} for ${domain}`)
    }
    const body = (await response.json()) as {
      events?: { eventAction: string; eventDate: string }[]
    }
    const registered = body.events?.find((event) => event.eventAction === 'registration')
    return registered ? DateTime.fromISO(registered.eventDate) : null
  }
}

/** In-memory stand-in for tests: registration dates by domain, unknown otherwise. */
export class FakeRdapClient implements RdapClient {
  readonly dates = new Map<string, DateTime>()
  readonly looked: string[] = []

  async registrationDate(domain: string): Promise<DateTime | null> {
    this.looked.push(domain)
    return this.dates.get(domain) ?? null
  }

  reset() {
    this.dates.clear()
    this.looked.length = 0
  }
}
