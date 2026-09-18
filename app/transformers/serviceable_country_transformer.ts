import { BaseTransformer } from '@adonisjs/core/transformers'
import type ServiceableCountry from '#models/serviceable_country'

export default class ServiceableCountryTransformer extends BaseTransformer<ServiceableCountry> {
  async toObject() {
    return {
      countryCode: this.resource.countryCode,
      countryName: this.resource.countryName,
    }
  }
}
