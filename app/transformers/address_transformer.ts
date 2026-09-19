import { BaseTransformer } from '@adonisjs/core/transformers'
import type Address from '#models/address'

export default class AddressTransformer extends BaseTransformer<Address> {
  async toObject() {
    return {
      uuid: this.resource.uuid,
      label: this.resource.label,
      recipientName: this.resource.recipientName,
      line1: this.resource.line1,
      line2: this.resource.line2,
      city: this.resource.city,
      state: this.resource.state,
      postalCode: this.resource.postalCode,
      country: this.resource.country,
      isDefault: this.resource.isDefault,
    }
  }
}
