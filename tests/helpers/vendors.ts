import string from '@adonisjs/core/helpers/string'
import { DateTime } from 'luxon'
import env from '#start/env'
import Material from '#models/material'
import User from '#models/user'
import type Vendor from '#models/vendor'
import VendorTaxDocument from '#models/vendor_tax_document'
import VendorTechnologyCapability from '#models/vendor_technology_capability'
import { createAddress } from '#services/address_service'
import { makePayoutReady, setPayoutRate } from '#tests/helpers/payouts'

/**
 * Vendor columns for a vendor that has already been through onboarding - what
 * every spec not about onboarding itself wants. Routing, acceptance and staff
 * project access only count active vendors on the current agreement version
 * (see docs/VENDOR_ONBOARDING.md), so a bare Vendor.create() would be ignored.
 *
 * Capabilities need `status: 'approved'` for the same reason.
 */
export function activeVendorAttributes() {
  return {
    status: 'active' as const,
    agreementVersion: env.get('VENDOR_AGREEMENT_VERSION') ?? null,
  }
}

/** Signs up through the public endpoint (for a session), then sets the role. */
export async function signupAs(client: any, role: 'admin' | 'customer') {
  const email = `${role}-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: role,
    lastName: 'User',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  if (role !== 'customer') {
    user.role = role
    await user.save()
  }
  return { session: response.session(), user }
}

/** The signed API path inside an admin's `inviteUrl` (`…?link=<encoded path>`). */
export function inviteLinkPath(inviteUrl: string): string {
  const link = new URL(inviteUrl).searchParams.get('link')
  if (!link) throw new Error(`No link in ${inviteUrl}`)
  return link
}

/** Admin invites `email` as a vendor; returns the signed show path. */
export async function inviteVendor(client: any, adminSession: any, email: string) {
  const response = await client
    .post('/v1/admin/invitations')
    .withSession(adminSession)
    .json({ email, role: 'vendor' })
  response.assertStatus(200)
  return inviteLinkPath(response.body().data.inviteUrl)
}

/** Follows an invite link the way the frontend does: GET it, then POST to its acceptUrl. */
export async function acceptInviteLink(client: any, linkPath: string, password = 'password123') {
  const show = await client.get(linkPath)
  show.assertStatus(200)
  return client
    .post(show.body().data.acceptUrl)
    .json({ fullName: 'Vendor Person', password, passwordConfirmation: password })
}

/**
 * Fills in everything on the vendor's own checklist directly (profile,
 * default address, a requested capability, current agreement, tax form,
 * payout method) - for specs about what happens after it, not the steps.
 */
export async function completeVendorChecklist(
  vendor: Vendor,
  technologies: VendorTechnologyCapability['technology'][] = ['fdm']
) {
  vendor.merge({
    displayName: 'Acme Print',
    legalName: 'Acme Print LLC',
    agreementVersion: env.get('VENDOR_AGREEMENT_VERSION') ?? null,
    agreementAcceptedAt: DateTime.now(),
    taxClassification: 'llc',
  })
  await vendor.save()

  await createAddress({
    ownerType: 'vendor',
    vendorId: vendor.id,
    recipientName: 'Acme Print',
    line1: '1 Main St',
    city: 'Oakland',
    state: 'CA',
    postalCode: '94600',
    country: 'US',
    isDefault: true,
  })

  for (const technology of technologies) {
    await VendorTechnologyCapability.updateOrCreate(
      { vendorId: vendor.id, technology },
      { status: 'requested', isPreferred: false }
    )
  }

  await VendorTaxDocument.create({
    uuid: string.uuid(),
    vendorId: vendor.id,
    formType: 'w9',
    storageKey: `test/vendors/${vendor.uuid}/tax/${string.uuid()}.pdf`,
    originalName: 'w9.pdf',
  })

  await makePayoutReady(vendor)
}

/**
 * Everything on the admin checklist, directly: capabilities approved, tax
 * form verified, and a payout rate for every material of an approved
 * technology.
 */
export async function completeAdminChecklist(vendor: Vendor, admin: User) {
  await VendorTechnologyCapability.query()
    .where('vendorId', vendor.id)
    .update({ status: 'approved', reviewed_at: DateTime.now().toSQL(), reviewed_by_id: admin.id })

  await VendorTaxDocument.query()
    .where('vendorId', vendor.id)
    .whereNull('verifiedAt')
    .whereNull('rejectedAt')
    .update({ verified_at: DateTime.now().toSQL(), verified_by_id: admin.id })

  const capabilities = await VendorTechnologyCapability.query().where('vendorId', vendor.id)
  const technologies = capabilities.map((capability) => capability.technology)
  const materials = await Material.query().whereIn('technology', technologies)
  for (const material of materials) {
    await setPayoutRate(vendor, material, '70.00')
  }
}

/** Awaits a request and asserts its status - `(await request).assertStatus(n)` without the member-on-await. */
export async function expectStatus(request: PromiseLike<any>, status: number) {
  const response = await request
  response.assertStatus(status)
  return response
}
