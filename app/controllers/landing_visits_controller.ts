import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import { recordLandingVisit } from '#services/search_analytics_service'
import { landingVisitValidator } from '#validators/vendor_directory'

/** Our own hosts, so a referrer from them counts as navigation rather than an arrival. */
function ownHosts(): string[] {
  const hosts = new Set<string>(['makexyz.com'])
  for (const value of [env.get('MESSAGES_URL'), env.get('LINKS_URL')]) {
    if (!value) continue
    try {
      hosts.add(new URL(value).hostname.toLowerCase())
    } catch {
      // Not a URL - ignore.
    }
  }
  return [...hosts]
}

/**
 * POST /v1/analytics/landing-visits - the frontend records a visitor landing
 * on a page, the second first-party demand signal for city-page scoring
 * (docs/plans/manual_quotes.md, 2g). Best effort: always 204.
 */
export default class LandingVisitsController {
  async store({ request, response }: HttpContext) {
    const input = await request.validateUsing(landingVisitValidator)
    await recordLandingVisit({
      path: input.path,
      referrer: input.referrer ?? null,
      sessionKey: input.sessionKey ?? null,
      ownHosts: ownHosts(),
    })
    return response.noContent()
  }
}
