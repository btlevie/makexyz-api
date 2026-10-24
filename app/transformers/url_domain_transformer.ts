import { BaseTransformer } from '@adonisjs/core/transformers'
import type { DomainView } from '#services/url_domain_admin_service'

/** A link domain as admins see it: its effective list, the built-in default, and how widely it's seen. */
export default class UrlDomainTransformer extends BaseTransformer<DomainView> {
  toObject() {
    return this.pick(this.resource, [
      'domain',
      'listStatus',
      'builtinStatus',
      'overridden',
      'note',
      'seenCount',
      'firstSeenAt',
      'lastSeenAt',
      'registeredAt',
    ])
  }
}
