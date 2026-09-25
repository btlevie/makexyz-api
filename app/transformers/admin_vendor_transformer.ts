import { BaseTransformer } from '@adonisjs/core/transformers'
import type Vendor from '#models/vendor'
import { getAdminChecklist, getOnboardingSnapshot } from '#services/vendor_onboarding_service'
import { onboardingPayload } from '#transformers/vendor_onboarding_transformer'

/** The admin review view of a vendor: the onboarding payload plus the admin-side checklist. */
export default class AdminVendorTransformer extends BaseTransformer<Vendor> {
  async toObject() {
    const vendor = this.resource
    await vendor.load('user')
    await vendor.load('activatedBy')

    const snapshot = await getOnboardingSnapshot(vendor)
    return {
      ...onboardingPayload(vendor, snapshot),
      user: vendor.user
        ? { uuid: vendor.user.uuid, email: vendor.user.email, fullName: vendor.user.fullName }
        : null,
      activatedBy: vendor.activatedBy
        ? { uuid: vendor.activatedBy.uuid, fullName: vendor.activatedBy.fullName }
        : null,
      adminChecklist: await getAdminChecklist(vendor, snapshot),
    }
  }
}
