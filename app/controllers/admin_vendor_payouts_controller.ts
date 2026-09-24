import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Material from '#models/material'
import Vendor from '#models/vendor'
import VendorPayout from '#models/vendor_payout'
import VendorPayoutRate from '#models/vendor_payout_rate'
import VendorPayoutMethodTransformer from '#transformers/vendor_payout_method_transformer'
import VendorPayoutRateTransformer from '#transformers/vendor_payout_rate_transformer'
import VendorPayoutTransformer from '#transformers/vendor_payout_transformer'
import {
  PAYOUT_STATUSES,
  payoutRatesValidator,
  releasePayoutValidator,
  updateVendorPayoutSettingsValidator,
} from '#validators/vendor_payout'
import { isAdmin } from '#services/project_grant_service'
import {
  cancelPayout,
  InvalidPayoutAdjustmentError,
  PayoutNotActionableError,
  releaseHeldPayout,
  retryFailedPayout,
} from '#services/vendor_payout_service'

/**
 * Admin-only payout review and vendor payout configuration - isAdmin() check
 * per action, same as admin_quotes_controller.ts.
 */
export default class AdminVendorPayoutsController {
  /** Payouts across all vendors, optionally filtered by ?status= (e.g. held, failed). */
  async index(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }

    const status = request.input('status')
    if (status !== undefined && !PAYOUT_STATUSES.includes(status)) {
      return response.unprocessableEntity({
        error: `status must be one of ${PAYOUT_STATUSES.join(', ')}`,
      })
    }

    const query = VendorPayout.query()
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .preload('order')
      .preload('vendor')
    if (status) {
      query.where('status', status)
    }
    return await serialize(VendorPayoutTransformer.transform(await query))
  }

  private async findPayout(ctx: HttpContext): Promise<VendorPayout | null> {
    return VendorPayout.findBy('uuid', ctx.params.uuid)
  }

  private async respondWithPayout(ctx: HttpContext, payout: VendorPayout) {
    await payout.load('order')
    await payout.load('vendor')
    return ctx.serialize(VendorPayoutTransformer.transform(payout))
  }

  private handleActionError(ctx: HttpContext, error: unknown) {
    if (error instanceof PayoutNotActionableError) {
      return ctx.response.conflict({ error: error.message })
    }
    if (error instanceof InvalidPayoutAdjustmentError) {
      return ctx.response.unprocessableEntity({ error: error.message })
    }
    throw error
  }

  /** Releases a held payout (optionally at a reduced amount) to be sent on the next run. */
  async release(ctx: HttpContext) {
    const { request, response } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { amount } = await request.validateUsing(releasePayoutValidator)
    const payout = await this.findPayout(ctx)
    if (!payout) {
      return response.notFound({ error: 'Payout not found' })
    }

    try {
      await releaseHeldPayout(payout, ctx.auth.getUserOrFail().id, amount)
      return await this.respondWithPayout(ctx, payout)
    } catch (error) {
      return this.handleActionError(ctx, error)
    }
  }

  async cancel(ctx: HttpContext) {
    const { response } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const payout = await this.findPayout(ctx)
    if (!payout) {
      return response.notFound({ error: 'Payout not found' })
    }

    try {
      await cancelPayout(payout, ctx.auth.getUserOrFail().id)
      return await this.respondWithPayout(ctx, payout)
    } catch (error) {
      return this.handleActionError(ctx, error)
    }
  }

  /** Re-queues a failed payout once the platform-side cause is fixed. */
  async retry(ctx: HttpContext) {
    const { response } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const payout = await this.findPayout(ctx)
    if (!payout) {
      return response.notFound({ error: 'Payout not found' })
    }

    try {
      await retryFailedPayout(payout, ctx.auth.getUserOrFail().id)
      return await this.respondWithPayout(ctx, payout)
    } catch (error) {
      return this.handleActionError(ctx, error)
    }
  }

  /** A vendor's per-material payout rates. */
  async rates(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }

    const rates = await VendorPayoutRate.query().where('vendorId', vendor.id).preload('material')
    return await serialize(VendorPayoutRateTransformer.transform(rates))
  }

  /**
   * Upserts per-material rates (materials not listed are left as they are).
   * Rates only affect orders accepted from now on - accepted orders keep the
   * payout snapshot taken at acceptance.
   */
  async updateRates(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { rates } = await request.validateUsing(payoutRatesValidator)
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }

    const materials = await Material.query().whereIn(
      'uuid',
      rates.map((rate) => rate.materialUuid)
    )
    const materialByUuid = new Map(materials.map((material) => [material.uuid, material]))
    const unknown = rates.filter((rate) => !materialByUuid.has(rate.materialUuid))
    if (unknown.length > 0) {
      return response.unprocessableEntity({
        error: `Unknown material(s): ${unknown.map((rate) => rate.materialUuid).join(', ')}`,
      })
    }

    await db.transaction(async (trx) => {
      for (const rate of rates) {
        await VendorPayoutRate.updateOrCreate(
          { vendorId: vendor.id, materialId: materialByUuid.get(rate.materialUuid)!.id },
          { percentage: rate.percentage.toFixed(2) },
          { client: trx }
        )
      }
    })

    const saved = await VendorPayoutRate.query().where('vendorId', vendor.id).preload('material')
    return await serialize(VendorPayoutRateTransformer.transform(saved))
  }

  /** Per-vendor payout settings - currently just the hold period override. */
  async updateVendor(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { payoutHoldDays } = await request.validateUsing(updateVendorPayoutSettingsValidator)
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }

    vendor.payoutHoldDays = payoutHoldDays
    await vendor.save()
    return await serialize(VendorPayoutMethodTransformer.transform(vendor))
  }
}
