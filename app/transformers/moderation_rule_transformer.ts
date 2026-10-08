import { BaseTransformer } from '@adonisjs/core/transformers'
import type { RuleView } from '#services/moderation_rule_admin_service'

/** A moderation rule as admins see it: defaults alongside what's in force. */
export default class ModerationRuleTransformer extends BaseTransformer<RuleView> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'version',
      'description',
      'defaultMode',
      'mode',
      'defaultConfig',
      'config',
      'configVersion',
    ])
  }
}
