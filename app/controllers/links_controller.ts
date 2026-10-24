import type { HttpContext } from '@adonisjs/core/http'
import { checkLink } from '#services/url_analysis_service'

/**
 * The "you're leaving MakeXYZ" interstitial's API. Message links are only
 * ever handed out as tokens; the frontend page calls this when someone
 * clicks one, and it re-checks the link before giving out the URL.
 *
 * Public: notification emails carry these links to people who may not be
 * signed in. The token is unguessable and only reveals a URL that was sent
 * in a message.
 */
export default class LinksController {
  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const link = await checkLink(params.token)
    if (!link) {
      return response.notFound({ error: 'Link not found' })
    }
    return await serialize(link)
  }
}
