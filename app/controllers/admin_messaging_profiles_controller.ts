import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import MessagingRiskProfileTransformer from '#transformers/messaging_risk_profile_transformer'
import { adminListProfilesValidator } from '#validators/messaging'
import { isAdmin } from '#services/project_grant_service'

const MAX_LISTED = 200

/**
 * Senders' messaging risk profiles: tier, temporary holds and the counters
 * behind them (messaging_risk_service.ts). Read-only - tiers are changed
 * through a case (POST moderation/cases/:uuid/restrict).
 */
export default class AdminMessagingProfilesController {
  async index(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { tier, held } = await request.validateUsing(adminListProfilesValidator)

    const profiles = await MessagingRiskProfile.query()
      .if(tier, (query) => query.where('trustTier', tier!))
      .if(held, (query) => query.where('holdUntil', '>', DateTime.now().toSQL()!))
      .orderBy('updatedAt', 'desc')
      .limit(MAX_LISTED)
      .preload('customer')
      .preload('vendor')

    return await serialize(MessagingRiskProfileTransformer.transform(profiles))
  }
}
