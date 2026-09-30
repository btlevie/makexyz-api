import { MessagingRiskProfileSchema } from '#database/schema'

/**
 * A customer's or vendor's messaging trust tier - messaging only, it never
 * touches ordering or fulfilment. See docs/plans/messaging_moderation.md
 * (Behavioral detection).
 */
export default class MessagingRiskProfile extends MessagingRiskProfileSchema {}
