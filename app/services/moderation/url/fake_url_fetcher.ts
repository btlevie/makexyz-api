import type { RedirectResult, UrlFetcher } from '#services/moderation/url/safe_url_fetcher'

/**
 * In-memory stand-in for SafeUrlFetcher in tests: redirects are declared per
 * URL, a URL can be marked as pointing into a private network, and anything
 * else resolves to itself.
 */
export class FakeUrlFetcher implements UrlFetcher {
  readonly redirects = new Map<string, string>()
  readonly blocked = new Set<string>()
  readonly resolved: string[] = []

  async resolve(url: string): Promise<RedirectResult> {
    this.resolved.push(url)
    const chain = [url]
    let current = url
    while (this.redirects.has(current) && chain.length <= 6) {
      current = this.redirects.get(current)!
      chain.push(current)
      if (this.blocked.has(current)) {
        return { chain, finalUrl: current, blockedHop: current, error: null }
      }
    }
    return { chain, finalUrl: current, blockedHop: null, error: null }
  }

  reset() {
    this.redirects.clear()
    this.blocked.clear()
    this.resolved.length = 0
  }
}
