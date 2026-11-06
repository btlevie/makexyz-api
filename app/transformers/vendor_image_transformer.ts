import { BaseTransformer } from '@adonisjs/core/transformers'
import type VendorImage from '#models/vendor_image'
import { imageUrls } from '#services/vendor_image_service'

/** The vendor's own view of an image: its check status, and URLs once approved. Storage keys never leave. */
export default class VendorImageTransformer extends BaseTransformer<VendorImage> {
  async toObject() {
    const urls = await imageUrls(this.resource)
    return {
      uuid: this.resource.uuid,
      kind: this.resource.kind,
      status: this.resource.status,
      rejectReason: this.resource.rejectReason,
      position: this.resource.position,
      url: urls?.url ?? null,
      thumbnailUrl: urls?.thumbnailUrl ?? null,
      createdAt: this.resource.createdAt,
    }
  }
}
