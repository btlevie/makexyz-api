import { BaseTransformer } from '@adonisjs/core/transformers'
import type ServiceLocation from '#models/service_location'

/**
 * A city page as the public sees it. No coordinates or place IDs - only
 * names, the slug and indexability. A plain function too, for responses that
 * nest a page inside another object (serialize only resolves transformers at
 * the top level).
 */
export function publicLocation(location: ServiceLocation) {
  return {
    slug: location.slug,
    city: location.city,
    state: location.state,
    country: location.country,
    isIndexable: location.isIndexable,
    servedAreaNames: location.servedAreaNames ?? [],
  }
}

export default class ServiceLocationTransformer extends BaseTransformer<ServiceLocation> {
  toObject() {
    return publicLocation(this.resource)
  }
}
