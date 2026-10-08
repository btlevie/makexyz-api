/**
 * The moderator audit trail (moderation_actions): every human decision and
 * rule change, append-only. Callers pass their transaction so the record and
 * the change it describes commit together.
 */
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import ModerationAction from '#models/moderation_action'

export async function recordModerationAction(
  input: {
    actorUserId: number | null
    caseId?: number | null
    action: ModerationAction['action']
    targetType: string
    targetId: string
    reason?: string | null
    metadata?: Record<string, unknown> | null
  },
  trx?: TransactionClientContract
): Promise<ModerationAction> {
  return ModerationAction.create(
    {
      actorUserId: input.actorUserId,
      caseId: input.caseId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason ?? null,
      metadata: input.metadata ?? null,
    },
    trx ? { client: trx } : {}
  )
}
