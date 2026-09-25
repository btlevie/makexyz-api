import type { HttpContext } from '@adonisjs/core/http'
import drive from '@adonisjs/drive/services/main'
import Vendor from '#models/vendor'
import AdminVendorTransformer from '#transformers/admin_vendor_transformer'
import { TECHNOLOGIES } from '#validators/vendor_onboarding'
import {
  rejectTaxDocumentValidator,
  reviewCapabilityValidator,
  suspendVendorValidator,
  VENDOR_STATUSES,
} from '#validators/admin_vendor'
import { isAdmin } from '#services/project_grant_service'
import {
  activateVendor,
  CapabilityNotRequestedError,
  ChecklistIncompleteError,
  latestTaxDocument,
  reinstateVendor,
  rejectTaxDocument,
  reviewCapability,
  suspendVendor,
  TaxDocumentAlreadyReviewedError,
  TaxDocumentNotFoundError,
  VendorStatusError,
  verifyTaxDocument,
} from '#services/vendor_onboarding_service'

/** How long an admin's tax-document download link stays valid. */
const TAX_DOCUMENT_URL_TTL_SECONDS = 5 * 60

/**
 * Admin review of vendors: capability approval, tax verification, activation
 * and suspension - see vendor_onboarding_service.ts and
 * docs/VENDOR_ONBOARDING.md. Payout rates and the hold-period override stay on
 * AdminVendorPayoutsController. Same manual isAdmin() check as the other admin
 * controllers (no policy/ability convention exists yet, see CLAUDE.md).
 */
export default class AdminVendorsController {
  /** Vendors, optionally filtered by ?status= (e.g. pending_review for the review queue). */
  async index(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }

    const status = request.input('status')
    if (status !== undefined && !VENDOR_STATUSES.includes(status)) {
      return response.unprocessableEntity({
        error: `status must be one of ${VENDOR_STATUSES.join(', ')}`,
      })
    }

    const query = Vendor.query().orderBy('createdAt', 'desc').orderBy('id', 'desc')
    if (status) {
      query.where('status', status)
    }
    return await serialize(AdminVendorTransformer.transform(await query))
  }

  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }
    return await serialize(AdminVendorTransformer.transform(vendor))
  }

  /** Approves or rejects a capability the vendor requested, optionally setting preferred. */
  async reviewCapability(ctx: HttpContext) {
    const { params, request, response, serialize, auth } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }
    if (!(TECHNOLOGIES as readonly string[]).includes(params.technology)) {
      return response.unprocessableEntity({
        error: `technology must be one of ${TECHNOLOGIES.join(', ')}`,
      })
    }
    const decision = await request.validateUsing(reviewCapabilityValidator)

    try {
      await reviewCapability(vendor, params.technology, decision, auth.getUserOrFail().id)
    } catch (error) {
      return this.handleError(error, response)
    }
    return await serialize(AdminVendorTransformer.transform(vendor))
  }

  /**
   * A short-lived download link for the vendor's current tax document. The
   * document itself sits on the private s3 disk.
   */
  async taxDocument(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }
    const document = await latestTaxDocument(vendor.id)
    if (!document) {
      return response.notFound({ error: 'No tax document uploaded' })
    }

    const url = await drive.use('s3').getSignedUrl(document.storageKey, {
      expiresIn: TAX_DOCUMENT_URL_TTL_SECONDS,
      contentType: 'application/pdf',
    })
    return await serialize({ url, expiresInSeconds: TAX_DOCUMENT_URL_TTL_SECONDS })
  }

  async verifyTax(ctx: HttpContext) {
    const { params, response, serialize, auth } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }

    try {
      await verifyTaxDocument(vendor, auth.getUserOrFail().id)
    } catch (error) {
      return this.handleError(error, response)
    }
    return await serialize(AdminVendorTransformer.transform(vendor))
  }

  async rejectTax(ctx: HttpContext) {
    const { params, request, response, serialize, auth } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }
    const { reason } = await request.validateUsing(rejectTaxDocumentValidator)

    try {
      await rejectTaxDocument(vendor, reason, auth.getUserOrFail().id)
    } catch (error) {
      return this.handleError(error, response)
    }
    return await serialize(AdminVendorTransformer.transform(vendor))
  }

  async activate(ctx: HttpContext) {
    const { params, response, serialize, auth } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }

    try {
      await activateVendor(vendor, auth.getUserOrFail().id)
    } catch (error) {
      return this.handleError(error, response)
    }
    return await serialize(AdminVendorTransformer.transform(vendor))
  }

  async suspend(ctx: HttpContext) {
    const { params, request, response, serialize, auth } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }
    const { reason } = await request.validateUsing(suspendVendorValidator)

    try {
      await suspendVendor(vendor, reason, auth.getUserOrFail().id)
    } catch (error) {
      return this.handleError(error, response)
    }
    return await serialize(AdminVendorTransformer.transform(vendor))
  }

  async reinstate(ctx: HttpContext) {
    const { params, response, serialize, auth } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', params.uuid)
    if (!vendor) {
      return response.notFound({ error: 'Vendor not found' })
    }

    try {
      await reinstateVendor(vendor, auth.getUserOrFail().id)
    } catch (error) {
      return this.handleError(error, response)
    }
    return await serialize(AdminVendorTransformer.transform(vendor))
  }

  private handleError(error: unknown, response: HttpContext['response']) {
    if (error instanceof VendorStatusError || error instanceof TaxDocumentAlreadyReviewedError) {
      return response.conflict({ error: error.message })
    }
    if (error instanceof CapabilityNotRequestedError || error instanceof TaxDocumentNotFoundError) {
      return response.notFound({ error: error.message })
    }
    if (error instanceof ChecklistIncompleteError) {
      return response.unprocessableEntity({
        error: error.message,
        checklist: error.checklist,
        adminChecklist: error.adminChecklist,
      })
    }
    throw error
  }
}
