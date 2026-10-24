import { BaseTransformer } from '@adonisjs/core/transformers'
import type ModerationCase from '#models/moderation_case'
import AdminMessageTransformer from '#transformers/admin_message_transformer'

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
      // Behavioral cases: what the pattern is (the blocked messages behind an
      // auto-hold, the accounts in a cluster, a volume spike).
      details: moderationCase.details,
      conversationUuid: (moderationCase.$extras.conversationUuid ?? null) as string | null,
      message: moderationCase.message
        ? await AdminMessageTransformer.transform(moderationCase.message)
        : null,
      createdAt: moderationCase.createdAt,
      resolvedAt: moderationCase.resolvedAt,
    }
  }
}
