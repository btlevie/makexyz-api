import type { HttpContext } from '@adonisjs/core/http'
import Vendor from '#models/vendor'
import VendorImage from '#models/vendor_image'
import { isAdmin } from '#services/project_grant_service'
import { recordModerationAction } from '#services/moderation_action_service'
import {
  adminSetServiceActive,
  adminUnpublish,
  ProfileError,
} from '#services/vendor_profile_service'
import { rejectImage, reviewUrl } from '#services/vendor_image_service'
import VendorProfileTransformer from '#transformers/vendor_profile_transformer'
import {
  adminSetServiceValidator,
  adminUnpublishProfileValidator,
  VENDOR_SERVICE_VALUES,
} from '#validators/vendor_directory'

/**
 * Admin controls over the public directory (docs/plans/manual_quotes.md,
 * section 2): see a vendor's profile as they do, take it out of the
 * directory, turn a listed service off, and reject an image. Profile text and
 * images held for a person are reviewed through the moderation queue
 * (vendor_profile / vendor_image cases).
 */
export default class AdminVendorProfilesController {
  async show(ctx: HttpContext) {
    if (!isAdmin(ctx)) {
      return ctx.response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', ctx.params.uuid)
    if (!vendor) {
      return ctx.response.notFound({ error: 'Vendor not found' })
    }
    return await ctx.serialize(VendorProfileTransformer.transform(vendor))
  }

  async unpublish(ctx: HttpContext) {
    if (!isAdmin(ctx)) {
      return ctx.response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', ctx.params.uuid)
    if (!vendor) {
      return ctx.response.notFound({ error: 'Vendor not found' })
    }
    const { reason } = await ctx.request.validateUsing(adminUnpublishProfileValidator)
    await adminUnpublish(vendor, ctx.auth.getUserOrFail(), reason)
    return await ctx.serialize(VendorProfileTransformer.transform(vendor))
  }

  async setService(ctx: HttpContext) {
    if (!isAdmin(ctx)) {
      return ctx.response.forbidden({ error: 'Admin access required' })
    }
    const vendor = await Vendor.findBy('uuid', ctx.params.uuid)
    if (!vendor) {
      return ctx.response.notFound({ error: 'Vendor not found' })
    }
    const service = ctx.params.service
    if (!(VENDOR_SERVICE_VALUES as readonly string[]).includes(service)) {
      return ctx.response.notFound({ error: 'Unknown service' })
    }
    const { active, reason } = await ctx.request.validateUsing(adminSetServiceValidator)
    try {
      await adminSetServiceActive(
        vendor,
        service as (typeof VENDOR_SERVICE_VALUES)[number],
        active,
        ctx.auth.getUserOrFail(),
        reason
      )
    } catch (error) {
      if (error instanceof ProfileError) {
        return ctx.response.status(error.status).send({ error: error.message })
      }
      throw error
    }
    return await ctx.serialize(VendorProfileTransformer.transform(vendor))
  }

  /** A moderator's look at an image (approved or under review), via a 5-minute link. */
  async showImage(ctx: HttpContext) {
    if (!isAdmin(ctx)) {
      return ctx.response.forbidden({ error: 'Admin access required' })
    }
    const image = await VendorImage.findBy('uuid', ctx.params.uuid)
    if (!image) {
      return ctx.response.notFound({ error: 'Image not found' })
    }
    return await ctx.serialize({
      uuid: image.uuid,
      kind: image.kind,
      status: image.status,
      rejectReason: image.rejectReason,
      moderationDetails: image.moderationDetails,
      url: await reviewUrl(image),
    })
  }

  async rejectImage(ctx: HttpContext) {
    if (!isAdmin(ctx)) {
      return ctx.response.forbidden({ error: 'Admin access required' })
    }
    const image = await VendorImage.query().where('uuid', ctx.params.uuid).preload('vendor').first()
    if (!image) {
      return ctx.response.notFound({ error: 'Image not found' })
    }
    const { reason } = await ctx.request.validateUsing(adminUnpublishProfileValidator)
    await rejectImage(image)
    await recordModerationAction({
      actorUserId: ctx.auth.getUserOrFail().id,
      action: 'reject_content',
      targetType: 'vendor_image',
      targetId: image.uuid,
      reason,
    })
    return ctx.response.noContent()
  }
}
