import type { HttpContext } from '@adonisjs/core/http'
import VendorImage from '#models/vendor_image'
import type Vendor from '#models/vendor'
import { resolveVendor } from '#services/vendor_onboarding_service'
import {
  ProfileBlockedError,
  ProfileError,
  setIndicativePrices,
  setServices,
  updatePublicProfile,
} from '#services/vendor_profile_service'
import {
  completeImageUpload,
  createImageUpload,
  deleteImage,
  reorderPortfolio,
  VendorImageError,
} from '#services/vendor_image_service'
import VendorImageTransformer from '#transformers/vendor_image_transformer'
import VendorProfileTransformer from '#transformers/vendor_profile_transformer'
import {
  createVendorImageValidator,
  reorderPortfolioValidator,
  setIndicativePricesValidator,
  setVendorServicesValidator,
  updatePublicProfileValidator,
} from '#validators/vendor_directory'

/**
 * The vendor's own public profile: text, publishing, services, indicative
 * prices and images (docs/plans/manual_quotes.md, section 2). Every write
 * returns the full profile so the frontend can re-render from the response.
 * Public text is moderated before it's saved - a block is a 422 with the
 * reason, and nothing changes.
 */
export default class VendorProfileController {
  async show(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    return await ctx.serialize(VendorProfileTransformer.transform(vendor))
  }

  async update(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    const input = await ctx.request.validateUsing(updatePublicProfileValidator)
    return this.run(ctx, vendor, () => updatePublicProfile(vendor, input))
  }

  async setServices(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    const { services } = await ctx.request.validateUsing(setVendorServicesValidator)
    return this.run(ctx, vendor, () => setServices(vendor, services))
  }

  async setPrices(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    const { prices } = await ctx.request.validateUsing(setIndicativePricesValidator)
    return this.run(ctx, vendor, () => setIndicativePrices(vendor, prices))
  }

  /** A presigned upload for one image; the browser PUTs it, then calls completeImage. */
  async createImage(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    const input = await ctx.request.validateUsing(createVendorImageValidator)
    try {
      const { image, uploadUrl } = await createImageUpload(vendor, input)
      ctx.response.status(201)
      return await ctx.serialize({ image: VendorImageTransformer.transform(image), uploadUrl })
    } catch (error) {
      return this.handleError(error, ctx.response)
    }
  }

  async completeImage(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    const image = await this.findOwnImage(vendor, ctx.params.uuid)
    if (!image) {
      return ctx.response.notFound({ error: 'Image not found' })
    }
    try {
      return await ctx.serialize(VendorImageTransformer.transform(await completeImageUpload(image)))
    } catch (error) {
      return this.handleError(error, ctx.response)
    }
  }

  async destroyImage(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    const image = await this.findOwnImage(vendor, ctx.params.uuid)
    if (!image) {
      return ctx.response.notFound({ error: 'Image not found' })
    }
    await deleteImage(image)
    return ctx.response.noContent()
  }

  async reorderImages(ctx: HttpContext) {
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return ctx.response.forbidden({ error: 'No vendor record for this account' })
    }
    const { uuids } = await ctx.request.validateUsing(reorderPortfolioValidator)
    try {
      return await ctx.serialize(
        VendorImageTransformer.transform(await reorderPortfolio(vendor, uuids))
      )
    } catch (error) {
      return this.handleError(error, ctx.response)
    }
  }

  private async findOwnImage(vendor: Vendor, uuid: string) {
    return VendorImage.query().where('vendorId', vendor.id).where('uuid', uuid).first()
  }

  private async run(ctx: HttpContext, vendor: Vendor, action: () => Promise<unknown>) {
    try {
      await action()
    } catch (error) {
      return this.handleError(error, ctx.response)
    }
    return await ctx.serialize(VendorProfileTransformer.transform(vendor))
  }

  private handleError(error: unknown, response: HttpContext['response']) {
    if (error instanceof ProfileBlockedError) {
      return response.unprocessableEntity({ error: error.reason, code: 'moderation_blocked' })
    }
    if (error instanceof ProfileError || error instanceof VendorImageError) {
      return response.status(error.status).send({ error: error.message })
    }
    throw error
  }
}
