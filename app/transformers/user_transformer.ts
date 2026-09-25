import type User from '#models/user'
import Vendor from '#models/vendor'
import { BaseTransformer } from '@adonisjs/core/transformers'
import { getOnboardingSnapshot } from '#services/vendor_onboarding_service'

export default class UserTransformer extends BaseTransformer<User> {
  async toObject() {
    return {
      ...this.pick(this.resource, [
        'id',
        'fullName',
        'email',
        'createdAt',
        'updatedAt',
        'initials',
      ]),
      vendor: await this.vendorSummary(),
    }
  }

  /**
   * What the frontend needs to decide where to send a vendor after login - the
   * onboarding checklist, the "under review" page or the dashboard (see
   * docs/VENDOR_ONBOARDING.md). Null for non-vendors.
   */
  private async vendorSummary() {
    if (this.resource.role !== 'vendor') {
      return null
    }
    const vendor = await Vendor.findBy('userId', this.resource.id)
    if (!vendor) {
      return null
    }
    const { onboardingComplete } = await getOnboardingSnapshot(vendor)
    return { uuid: vendor.uuid, status: vendor.status, onboardingComplete }
  }
}
