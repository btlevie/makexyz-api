import { BaseTransformer } from '@adonisjs/core/transformers'
import type { TermView } from '#services/moderation_term_admin_service'

/** A prohibited-item term as admins see it: where it comes from, what it does, how often it fires. */
export default class ModerationTermTransformer extends BaseTransformer<TermView> {
  toObject() {
    return this.pick(this.resource, [
      'uuid',
      'category',
      'term',
      'action',
      'status',
      'source',
      'overridden',
      'note',
      'updatedAt',
      'hits30d',
    ])
  }
}
