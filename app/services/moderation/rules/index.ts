/**
 * Every moderation rule, in evaluation order. Adding a rule is a new file in
 * this folder plus one line here - nothing else changes. Whether a rule is
 * off, shadow or enforce (and its thresholds) is runtime config in
 * moderation_rule_configs, not code.
 */
import type { ModerationRule } from '#services/moderation/types'
import contactEmail from '#services/moderation/rules/contact_email'
import contactPhone from '#services/moderation/rules/contact_phone'
import urlNonAllowlisted from '#services/moderation/rules/url_non_allowlisted'

export const RULES: ModerationRule<any>[] = [contactEmail, contactPhone, urlNonAllowlisted]
