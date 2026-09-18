import { BaseTransformer } from '@adonisjs/core/transformers'
import type CheckoutSession from '#models/checkout_session'

export default class CheckoutSessionTransformer extends BaseTransformer<CheckoutSession> {
  async toObject() {
    return {
      uuid: this.resource.uuid,
      status: this.resource.status,
      expiresAt: this.resource.expiresAt?.toISO() ?? null,
    }
  }
}
