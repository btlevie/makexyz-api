import { VendorPayoutSchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Order from '#models/order'
import Vendor from '#models/vendor'

/** Snapshot of how a payout's amount was derived - see payout_calculation_service.ts. */
export type PayoutBreakdown = {
  lines: {
    orderItemId: number
    description: string
    materialId: number
    materialName: string
    /** Decimal strings, dollars. */
    itemTotal: string
    percentage: string
    amount: string
  }[]
  /** Passed through to the vendor in full. */
  productionTimeFee: string
  /** Set when an admin releases a held payout at a different amount. */
  adjustment?: {
    previousAmount: string
    amount: string
    adjustedById: number
    adjustedAt: string
  }
  total: string
}

export default class VendorPayout extends VendorPayoutSchema {
  /**
   * Redeclared to serialize the JSON column in both directions - Postgres
   * returns a parsed object, SQLite (tests) a string. Same as AuditEvent.
   */
  @column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? value : JSON.stringify(value),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value === '' ? null : JSON.parse(value)) : (value ?? null),
  })
  declare breakdown: PayoutBreakdown

  /**
   * The provider idempotency key for the current send attempt - the uuid on
   * the first attempt, suffixed after a failure is re-queued (see
   * send_attempt in the migration). PayPal's sender_item_id carries it back
   * in webhooks.
   */
  get providerIdempotencyKey(): string {
    return this.sendAttempt > 1 ? `${this.uuid}-${this.sendAttempt}` : this.uuid
  }

  @belongsTo(() => Vendor)
  declare vendor: BelongsTo<typeof Vendor>

  @belongsTo(() => Order)
  declare order: BelongsTo<typeof Order>
}
