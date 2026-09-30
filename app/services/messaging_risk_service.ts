/**
 * A sender's messaging trust tier (docs/plans/messaging_moderation.md,
 * Behavioral detection). Messaging only - these never restrict quoting,
 * checkout or fulfilment.
 *
 * Step 1 reads tiers; setting them is a human decision for now (automatic
 * promotion/demotion arrives with behavioral detection).
 */
import { DateTime } from 'luxon'
import MessagingRiskProfile from '#models/messaging_risk_profile'

export type TrustTier = MessagingRiskProfile['trustTier']

export interface RiskPrincipal {
  customerId?: number | null
  vendorId?: number | null
}

/**
 * The tier in force right now. No profile means 'new'. A restriction past its
 * expiry no longer applies, and the sender is treated as 'standard'.
 */
export async function effectiveTrustTier(principal: RiskPrincipal): Promise<TrustTier> {
  const query = MessagingRiskProfile.query()
  if (principal.customerId) {
    query.where('customerId', principal.customerId)
  } else if (principal.vendorId) {
    query.where('vendorId', principal.vendorId)
  } else {
    return 'standard'
  }

  const profile = await query.first()
  if (!profile) {
    return 'new'
  }

  const restricted = profile.trustTier === 'restricted' || profile.trustTier === 'suspended'
  if (
    restricted &&
    profile.restrictionExpiresAt &&
    profile.restrictionExpiresAt <= DateTime.now()
  ) {
    return 'standard'
  }
  return profile.trustTier
}
