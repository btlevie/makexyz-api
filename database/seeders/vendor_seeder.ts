import { makexyzShipFromAddress } from '#config/shipping'
import Address from '#models/address'
import Material from '#models/material'
import User from '#models/user'
import Vendor from '#models/vendor'
import VendorPayoutRate from '#models/vendor_payout_rate'
import VendorTechnologyCapability from '#models/vendor_technology_capability'
import { createAddress } from '#services/address_service'
import { currentAgreementVersion } from '#services/vendor_onboarding_service'
import stringHelpers from '@adonisjs/core/helpers/string'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { DateTime } from 'luxon'

/**
 * Placeholder share of an item's total paid to the in-house vendor - verify
 * before relying on it. Rates are only ever created here, never overwritten,
 * so a real rate set through PUT /v1/admin/vendors/:uuid/payout-rates sticks.
 */
const PLACEHOLDER_PAYOUT_PERCENTAGE = '70.00'

/**
 * MakeXYZ's own in-house vendor, seeded straight into the 'active' state.
 *
 * Real vendors go through invitation -> onboarding -> admin review (see
 * docs/VENDOR_ONBOARDING.md). Seeding writes the end state directly instead,
 * with two gaps a seed can't fill:
 * - No payout method: account ids only ever come from Stripe/PayPal
 *   onboarding, so connect one through /v1/vendor/payout-method before this
 *   vendor can accept orders.
 * - No tax document: it's a file upload. Nothing gates on it once the vendor
 *   is active, but the admin checklist will show it as missing.
 * It also needs VENDOR_AGREEMENT_VERSION set in .env - with it unset the
 * agreement stays unaccepted and acceptance is blocked.
 */
export default class extends BaseSeeder {
  async run() {
    // Not updateOrCreate for the uuid-bearing rows: that applies its whole
    // payload on every run, and uuid must only ever be set at genuine creation
    // - never regenerated for a row that already exists (same as
    // material_seeder).
    const user = await User.firstOrCreate(
      { email: 'hello@makexyz.com' },
      {
        password: 'password',
        fullName: 'MakeXYZ Vendor',
        role: 'vendor',
        uuid: stringHelpers.uuid(),
      }
    )

    const vendor = await Vendor.firstOrCreate(
      { userId: user.id },
      { uuid: stringHelpers.uuid(), status: 'onboarding' }
    )

    const agreementVersion = currentAgreementVersion()
    vendor.merge({
      status: 'active',
      displayName: 'MakeXYZ',
      legalName: 'MakeXYZ',
      agreementVersion,
      agreementAcceptedAt: agreementVersion ? (vendor.agreementAcceptedAt ?? DateTime.now()) : null,
      submittedAt: vendor.submittedAt ?? DateTime.now(),
      activatedAt: vendor.activatedAt ?? DateTime.now(),
    })
    await vendor.save()

    await VendorTechnologyCapability.updateOrCreate(
      { vendorId: vendor.id, technology: 'fdm' },
      { status: 'approved', isPreferred: false, reviewedAt: DateTime.now() }
    )

    const hasDefaultAddress = await Address.query()
      .where('vendorId', vendor.id)
      .where('ownerType', 'vendor')
      .where('isDefault', true)
      .first()
    if (!hasDefaultAddress) {
      // MakeXYZ's configured ship-from address when there is one, otherwise a
      // placeholder to edit.
      const shipFrom = makexyzShipFromAddress()
      await createAddress({
        ownerType: 'vendor',
        vendorId: vendor.id,
        label: 'Business Address',
        recipientName: shipFrom.name || 'MakeXYZ',
        line1: shipFrom.street1 || '123 Placeholder St',
        line2: shipFrom.street2,
        city: shipFrom.city || 'San Francisco',
        state: shipFrom.state || 'CA',
        postalCode: shipFrom.zip || '94000',
        country: shipFrom.country || 'US',
        isDefault: true,
      })
    }

    const fdmMaterials = await Material.query().where('technology', 'fdm')
    for (const material of fdmMaterials) {
      await VendorPayoutRate.firstOrCreate(
        { vendorId: vendor.id, materialId: material.id },
        { percentage: PLACEHOLDER_PAYOUT_PERCENTAGE }
      )
    }
  }
}
