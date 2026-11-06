import { BaseTransformer } from '@adonisjs/core/transformers'
import type ModerationCase from '#models/moderation_case'
import Vendor from '#models/vendor'
import VendorImage from '#models/vendor_image'
import AdminMessageTransformer from '#transformers/admin_message_transformer'

/**
 * What a non-message case is about: a vendor's public profile text (shown
 * as it stands now) or a vendor image (viewable through
 * GET /v1/admin/vendor-images/:uuid).
 */
async function subjectOf(moderationCase: ModerationCase) {
  if (!moderationCase.subjectType || !moderationCase.subjectId) return null
  if (moderationCase.subjectType === 'vendor_profile') {
    const vendor = await Vendor.find(moderationCase.subjectId)
    return vendor
      ? {
          type: 'vendor_profile',
          vendorUuid: vendor.uuid,
          displayName: vendor.displayName,
          bio: vendor.bio,
          moderationStatus: vendor.profileModerationStatus,
        }
      : null
  }
  if (moderationCase.subjectType === 'vendor_image') {
    const image = await VendorImage.query()
      .where('id', moderationCase.subjectId)
      .preload('vendor')
      .first()
    return image
      ? {
          type: 'vendor_image',
          vendorUuid: image.vendor.uuid,
          imageUuid: image.uuid,
          kind: image.kind,
          status: image.status,
        }
      : null
  }
  return { type: moderationCase.subjectType }
}

/**
 * A review-queue item for admins. `$extras.conversationUuid` is set by the
 * controller when the case has a message.
 */
export default class ModerationCaseTransformer extends BaseTransformer<ModerationCase> {
  async toObject() {
    const moderationCase = this.resource
    return {
      uuid: moderationCase.uuid,
      source: moderationCase.source,
      priority: moderationCase.priority,
      status: moderationCase.status,
      resolution: moderationCase.resolution,
      patternNote: moderationCase.patternNote,
      abuseCategory: moderationCase.abuseCategory,
      missedByAutomation: moderationCase.missedByAutomation,
      // Who's working it; a claim older than CLAIM_MINUTES has lapsed.
      claimedById: moderationCase.status === 'claimed' ? moderationCase.assignedToId : null,
      claimedAt: moderationCase.status === 'claimed' ? moderationCase.claimedAt : null,
      // Behavioral cases: what the pattern is (the blocked messages behind an
      // auto-hold, the accounts in a cluster, a volume spike).
      details: moderationCase.details,
      conversationUuid: (moderationCase.$extras.conversationUuid ?? null) as string | null,
      subject: await subjectOf(moderationCase),
      message: moderationCase.message
        ? await AdminMessageTransformer.transform(moderationCase.message)
        : null,
      createdAt: moderationCase.createdAt,
      resolvedAt: moderationCase.resolvedAt,
    }
  }
}
