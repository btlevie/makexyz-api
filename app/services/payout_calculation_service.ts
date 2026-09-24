/**
 * What a vendor earns for an order. Snapshotted onto the VendorPayout when
 * the vendor accepts the order (see order_acceptance_service.ts) - the terms
 * they accepted under - and only recalculated if staff change a part's
 * material afterwards (see recalculatePendingPayoutsForProjectFile).
 *
 *   Σ(order item total × vendor's rate for that item's material)
 *   + 100% of the order's production-time fee
 *
 * Shipping (MakeXYZ pays for labels) and tax are never part of it.
 *
 * All arithmetic is in integer cents, never on the decimal strings or floats
 * directly - each line is rounded once, then lines are summed.
 */
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import type Order from '#models/order'
import OrderItem from '#models/order_item'
import type Vendor from '#models/vendor'
import VendorPayout, { type PayoutBreakdown } from '#models/vendor_payout'
import VendorPayoutRate from '#models/vendor_payout_rate'

const FALLBACK_PAYOUT_HOLD_DAYS = 10

/** A vendor can't accept (or keep) an order without a rate for every item's material. */
export class PayoutRateMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayoutRateMissingError'
  }
}

export function toCents(amount: string | number | null | undefined): number {
  return Math.round(Number(amount ?? 0) * 100)
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** Days after delivery before this vendor's payouts are sent. */
export function payoutHoldDays(vendor: Vendor): number {
  return vendor.payoutHoldDays ?? env.get('PAYOUT_DEFAULT_HOLD_DAYS') ?? FALLBACK_PAYOUT_HOLD_DAYS
}

export async function computePayoutBreakdown(
  order: Order,
  vendor: Vendor,
  trx?: TransactionClientContract
): Promise<PayoutBreakdown> {
  const clientOptions = trx ? { client: trx } : {}
  const items = await OrderItem.query(clientOptions)
    .where('orderId', order.id)
    .orderBy('id', 'asc')
    .preload('projectFile', (query) => query.preload('material'))

  const materialIds = [
    ...new Set(
      items.map((item) => item.projectFile?.materialId).filter((id): id is number => !!id)
    ),
  ]
  const rates = materialIds.length
    ? await VendorPayoutRate.query(clientOptions)
        .where('vendorId', vendor.id)
        .whereIn('materialId', materialIds)
    : []
  const rateByMaterial = new Map(rates.map((rate) => [rate.materialId, rate]))

  const problems: string[] = []
  const lines: PayoutBreakdown['lines'] = []
  let totalCents = 0

  for (const item of items) {
    const material = item.projectFile?.material
    if (!material) {
      problems.push(`"${item.description ?? `item ${item.id}`}" has no material`)
      continue
    }
    const rate = rateByMaterial.get(material.id)
    if (!rate) {
      problems.push(`no payout rate for ${material.name}`)
      continue
    }

    const amountCents = Math.round((toCents(item.total) * Number(rate.percentage)) / 100)
    totalCents += amountCents
    lines.push({
      orderItemId: item.id,
      description: item.description ?? '',
      materialId: material.id,
      materialName: material.name,
      itemTotal: item.total,
      percentage: rate.percentage,
      amount: fromCents(amountCents),
    })
  }

  if (problems.length > 0) {
    throw new PayoutRateMissingError(
      `Order ${order.uuid} can't be accepted by this vendor: ${[...new Set(problems)].join('; ')}`
    )
  }

  const productionTimeFeeCents = toCents(order.productionTimeFeeAmount)
  totalCents += productionTimeFeeCents

  return {
    lines,
    productionTimeFee: fromCents(productionTimeFeeCents),
    total: fromCents(totalCents),
  }
}

/**
 * Staff can still change a part's material (or technology) on an accepted
 * order by overriding the quote/checkout lock. The vendor's pending payout
 * then no longer matches what they're making, so it's recomputed - inside
 * the caller's transaction, so a missing rate (PayoutRateMissingError)
 * refuses the whole change. Payouts past 'pending' are left alone.
 */
export async function recalculatePendingPayoutsForProjectFile(
  projectFileId: number,
  trx: TransactionClientContract
): Promise<void> {
  const orderIds = await OrderItem.query({ client: trx })
    .where('projectFileId', projectFileId)
    .select('order_id')
  const ids = [...new Set(orderIds.map((row) => row.orderId).filter((id): id is number => !!id))]
  if (ids.length === 0) {
    return
  }

  const payouts = await VendorPayout.query({ client: trx })
    .whereIn('orderId', ids)
    .where('status', 'pending')
    .forUpdate()
    .preload('vendor')
    .preload('order')

  for (const payout of payouts) {
    const breakdown = await computePayoutBreakdown(payout.order, payout.vendor, trx)
    payout.useTransaction(trx)
    payout.merge({ breakdown, amount: breakdown.total })
    await payout.save()
  }
}
