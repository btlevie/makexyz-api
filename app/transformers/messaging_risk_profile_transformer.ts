import { BaseTransformer } from '@adonisjs/core/transformers'
import type MessagingRiskProfile from '#models/messaging_risk_profile'

/** A sender's messaging risk profile as admins see it (customer/vendor preloaded). */
export default class MessagingRiskProfileTransformer extends BaseTransformer<MessagingRiskProfile> {
  toObject() {
    const profile = this.resource
    return {
      subject: profile.customer
        ? { type: 'customer', uuid: profile.customer.uuid }
        : profile.vendor
          ? { type: 'vendor', uuid: profile.vendor.uuid, displayName: profile.vendor.displayName }
          : null,
      trustTier: profile.trustTier,
      tierSource: profile.tierSource,
      restrictionExpiresAt: profile.restrictionExpiresAt,
      holdUntil: profile.holdUntil,
      holdReason: profile.holdReason,
      deliveredMessages: profile.deliveredMessages,
      confirmedViolations30d: profile.confirmedViolations,
      reportsReceived30d: profile.reportsReceived,
      vendorBlocks30d: profile.vendorBlocks,
      hourlyMean: profile.hourlyMean,
      computedAt: profile.computedAt,
    }
  }
}
