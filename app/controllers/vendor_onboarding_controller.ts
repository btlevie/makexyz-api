import type { HttpContext } from '@adonisjs/core/http'
import VendorOnboardingTransformer from '#transformers/vendor_onboarding_transformer'
import {
  acceptVendorAgreementValidator,
  setVendorCapabilitiesValidator,
  updateVendorProfileValidator,
  uploadVendorTaxDocumentValidator,
} from '#validators/vendor_onboarding'
import {
  acceptAgreement,
  AgreementVersionError,
  ChecklistIncompleteError,
  resolveVendor,
  setCapabilities,
  submitForReview,
  updateProfile,
  uploadTaxDocument,
  VendorStatusError,
} from '#services/vendor_onboarding_service'

/**
 * The vendor's own onboarding steps. Every endpoint returns the onboarding
 * payload (status + checklist) so the frontend can re-render the checklist
 * from the response. See docs/VENDOR_ONBOARDING.md.
 *
 * The business address and payout method steps reuse
 * VendorAddressesController / VendorPayoutMethodsController.
 */
export default class VendorOnboardingController {
  async show(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }
    return await serialize(VendorOnboardingTransformer.transform(vendor))
  }

  async updateProfile(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }
    const input = await request.validateUsing(updateVendorProfileValidator)

    try {
      await updateProfile(vendor, input)
    } catch (error) {
      return this.handleError(error, response)
    }
    return await serialize(VendorOnboardingTransformer.transform(vendor))
  }

  async setCapabilities(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }
    const { technologies } = await request.validateUsing(setVendorCapabilitiesValidator)

    try {
      await setCapabilities(vendor, technologies)
    } catch (error) {
      return this.handleError(error, response)
    }
    return await serialize(VendorOnboardingTransformer.transform(vendor))
  }

  /**
   * The IP comes from request.ip(), which honors config/app.ts trustProxy -
   * never a raw X-Forwarded-For entry, whose leftmost values the client
   * controls.
   */
  async acceptAgreement(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }
    const { version } = await request.validateUsing(acceptVendorAgreementValidator)

    try {
      await acceptAgreement(vendor, version, request.ip())
    } catch (error) {
      return this.handleError(error, response)
    }
    return await serialize(VendorOnboardingTransformer.transform(vendor))
  }

  async uploadTax(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }
    const input = await request.validateUsing(uploadVendorTaxDocumentValidator)

    await uploadTaxDocument(vendor, input)
    return await serialize(VendorOnboardingTransformer.transform(vendor))
  }

  async submit(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    try {
      await submitForReview(vendor)
    } catch (error) {
      return this.handleError(error, response)
    }
    return await serialize(VendorOnboardingTransformer.transform(vendor))
  }

  private handleError(error: unknown, response: HttpContext['response']) {
    if (error instanceof VendorStatusError) {
      return response.conflict({ error: error.message })
    }
    if (error instanceof AgreementVersionError) {
      return response.unprocessableEntity({ error: error.message })
    }
    if (error instanceof ChecklistIncompleteError) {
      return response.unprocessableEntity({ error: error.message, checklist: error.checklist })
    }
    throw error
  }
}
