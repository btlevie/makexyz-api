import { BaseTransformer } from '@adonisjs/core/transformers'
import type Quote from '#models/quote'

/**
 * Not QuoteTransformer's shape - admin needs each item's technology and
 * ProjectFile uuid to decide how to split, which the customer-facing
 * transformer doesn't expose.
 */
export default class AdminQuoteReviewTransformer extends BaseTransformer<Quote> {
  toObject() {
    return {
      uuid: this.resource.uuid,
      reviewReason: this.resource.reviewReason,
      createdAt: this.resource.createdAt,
      items: this.resource.items.map((item) => ({
        projectFileUuid: item.projectFile?.uuid ?? null,
        technology: item.projectFile?.technology ?? null,
        description: item.description,
      })),
    }
  }
}
