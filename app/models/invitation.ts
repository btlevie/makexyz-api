import { InvitationSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import User from '#models/user'

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export default class Invitation extends InvitationSchema {
  @belongsTo(() => User, { foreignKey: 'invitedById' })
  declare invitedBy: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'acceptedUserId' })
  declare acceptedUser: BelongsTo<typeof User>

  /**
   * Derived rather than stored, so it can never disagree with the timestamps
   * it's based on - accepted/revoked are terminal, expiry is time-based.
   */
  get status(): InvitationStatus {
    if (this.acceptedAt) return 'accepted'
    if (this.revokedAt) return 'revoked'
    if (this.expiresAt <= DateTime.now()) return 'expired'
    return 'pending'
  }
}
