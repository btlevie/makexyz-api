import { MessagingRiskProfileSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Customer from '#models/customer'
import Vendor from '#models/vendor'

/**
 * A customer's or vendor's messaging trust tier - messaging only, it never
 * touches ordering or fulfilment. See docs/plans/messaging_moderation.md
 * (Behavioral detection) and messaging_risk_service.ts.
 */
export default class MessagingRiskProfile extends MessagingRiskProfileSchema {
  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>
}
