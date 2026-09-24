import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import Vendor from '#models/vendor'
import VendorPayoutMethodTransformer from '#transformers/vendor_payout_method_transformer'
import { paypalConnectCallbackValidator } from '#validators/vendor_payout'
import {
  completePaypalConnect,
  PaypalAccountNotEligibleError,
  PaypalConnectStateError,
  PayoutAccountInUseError,
  refreshStripeStatus,
  startPaypalConnect,
  startStripeOnboarding,
} from '#services/vendor_payout_method_service'

/**
 * The vendor's own payout setup - Stripe Connect onboarding or Log in with
 * PayPal. See vendor_payout_method_service.ts.
 */
export default class VendorPayoutMethodsController {
  /** Same manual role check as vendor_orders_controller.ts. */
  private async resolveVendor(ctx: HttpContext): Promise<Vendor | null> {
    const user = ctx.auth.getUserOrFail()
    if (user.role !== 'vendor') {
      return null
    }
    return Vendor.findBy('userId', user.id)
  }

  /**
   * Current payout method and readiness. For Stripe this re-reads the
   * connected account first - it's what the frontend calls when the vendor
   * returns from onboarding.
   */
  async show(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await this.resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    if (vendor.payoutProvider === 'stripe' && vendor.stripeAccountId) {
      try {
        await refreshStripeStatus(vendor)
      } catch (error) {
        // Show the cached status rather than failing the whole page.
        logger.warn(
          { vendorUuid: vendor.uuid, error: String(error) },
          'Stripe status refresh failed'
        )
      }
    }

    return await serialize(VendorPayoutMethodTransformer.transform(vendor))
  }

  /** Starts (or resumes) Stripe Connect onboarding - returns the link to send the vendor to. */
  async startStripe(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await this.resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const url = await startStripeOnboarding(vendor)
    return await serialize({ url })
  }

  /** Starts Log in with PayPal - returns the PayPal sign-in URL. */
  async startPaypal(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await this.resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    return await serialize({ url: startPaypalConnect(vendor) })
  }

  /** Finishes Log in with PayPal with the code/state PayPal redirected back with. */
  async completePaypal(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    const vendor = await this.resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const { code, state } = await request.validateUsing(paypalConnectCallbackValidator)

    try {
      const updated = await completePaypalConnect(vendor, code, state)
      return await serialize(VendorPayoutMethodTransformer.transform(updated))
    } catch (error) {
      if (error instanceof PaypalConnectStateError) {
        return response.badRequest({ error: error.message })
      }
      if (error instanceof PaypalAccountNotEligibleError) {
        return response.unprocessableEntity({ error: error.message })
      }
      if (error instanceof PayoutAccountInUseError) {
        return response.conflict({ error: error.message })
      }
      throw error
    }
  }
}
