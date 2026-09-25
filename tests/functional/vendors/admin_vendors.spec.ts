import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import drive from '@adonisjs/drive/services/main'
import AuditEvent from '#models/audit_event'
import User from '#models/user'
import Vendor from '#models/vendor'
import VendorTaxDocument from '#models/vendor_tax_document'
import VendorTechnologyCapability from '#models/vendor_technology_capability'
import { createMaterial, setPayoutRate } from '#tests/helpers/payouts'
import {
  completeAdminChecklist,
  completeVendorChecklist,
  signupAs,
  expectStatus,
} from '#tests/helpers/vendors'

async function createVendor(status: Vendor['status'] = 'onboarding') {
  const user = await User.create({
    uuid: string.uuid(),
    email: `vendor-${string.uuid()}@test.com`,
    password: 'password123',
    role: 'vendor',
  })
  return Vendor.create({ uuid: string.uuid(), userId: user.id, status })
}

/** A vendor who has done their part and submitted - what the review queue holds. */
async function createSubmittedVendor() {
  const vendor = await createVendor()
  await completeVendorChecklist(vendor)
  vendor.status = 'pending_review'
  await vendor.save()
  return vendor
}

function item(list: { key: string; complete: boolean }[], key: string) {
  return list.find((entry) => entry.key === key)!
}

test.group('Vendors | admin review', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    drive.fake('s3')
    return async () => {
      drive.restore('s3')
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('non-admins get 403 on every admin vendor endpoint', async ({ client }) => {
    const customer = await signupAs(client, 'customer')
    const vendor = await createVendor()

    for (const [method, path] of [
      ['get', '/v1/admin/vendors'],
      ['get', `/v1/admin/vendors/${vendor.uuid}`],
      ['post', `/v1/admin/vendors/${vendor.uuid}/activate`],
      ['get', `/v1/admin/vendors/${vendor.uuid}/tax/document`],
    ] as const) {
      await expectStatus(client[method](path).withSession(customer.session), 403)
    }
  })

  test('lists vendors filtered by status, with both checklists', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const submitted = await createSubmittedVendor()
    await createVendor('onboarding')

    const queue = await client
      .get('/v1/admin/vendors')
      .qs({ status: 'pending_review' })
      .withSession(admin.session)

    queue.assertStatus(200)
    assert.lengthOf((queue.body() as any).data, 1)
    const row = (queue.body() as any).data[0]
    assert.equal(row.uuid, submitted.uuid)
    assert.isTrue(row.onboardingComplete)
    assert.deepEqual(
      row.adminChecklist.map((entry: { key: string }) => entry.key),
      ['capabilities_reviewed', 'tax_verified', 'payout_rates']
    )
    assert.isString(row.user.email)
    await expectStatus(
      client.get('/v1/admin/vendors').qs({ status: 'nope' }).withSession(admin.session),
      422
    )
  })

  test('approves and rejects capabilities; preferred only sticks when approved', async ({
    client,
    assert,
  }) => {
    const admin = await signupAs(client, 'admin')
    const vendor = await createSubmittedVendor()
    await VendorTechnologyCapability.create({
      vendorId: vendor.id,
      technology: 'sla',
      status: 'requested',
      isPreferred: false,
    })

    const approved = await client
      .patch(`/v1/admin/vendors/${vendor.uuid}/capabilities/fdm`)
      .withSession(admin.session)
      .json({ status: 'approved', isPreferred: true })
    approved.assertStatus(200)

    const rejected = await client
      .patch(`/v1/admin/vendors/${vendor.uuid}/capabilities/sla`)
      .withSession(admin.session)
      .json({ status: 'rejected', isPreferred: true })
    rejected.assertStatus(200)

    const capabilities = (rejected.body() as any).data.capabilities
    assert.deepEqual(
      capabilities.map((c: any) => [c.technology, c.status, c.isPreferred]),
      [
        ['fdm', 'approved', true],
        ['sla', 'rejected', false],
      ]
    )
    const fdm = await VendorTechnologyCapability.query()
      .where('vendorId', vendor.id)
      .where('technology', 'fdm')
      .firstOrFail()
    assert.equal(fdm.reviewedById, admin.user.id)

    // Never requested -> 404; not a technology -> 422.
    await expectStatus(
      client
        .patch(`/v1/admin/vendors/${vendor.uuid}/capabilities/sls`)
        .withSession(admin.session)
        .json({ status: 'approved' }),
      404
    )
    await expectStatus(
      client
        .patch(`/v1/admin/vendors/${vendor.uuid}/capabilities/cnc`)
        .withSession(admin.session)
        .json({ status: 'approved' }),
      422
    )
  })

  test('downloads, verifies and rejects the current tax document', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const vendor = await createSubmittedVendor()
    const document = await VendorTaxDocument.findByOrFail('vendorId', vendor.id)

    const download = await client
      .get(`/v1/admin/vendors/${vendor.uuid}/tax/document`)
      .withSession(admin.session)
    download.assertStatus(200)
    assert.include((download.body() as any).data.url, document.storageKey)
    assert.equal((download.body() as any).data.expiresInSeconds, 300)

    const verified = await client
      .post(`/v1/admin/vendors/${vendor.uuid}/tax/verify`)
      .withSession(admin.session)
    verified.assertStatus(200)
    assert.equal((verified.body() as any).data.taxDocument.status, 'verified')
    assert.isTrue(item((verified.body() as any).data.adminChecklist, 'tax_verified').complete)

    // Already reviewed.
    await expectStatus(
      client.post(`/v1/admin/vendors/${vendor.uuid}/tax/verify`).withSession(admin.session),
      409
    )
  })

  test('a rejected tax document reopens the vendor checklist item', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const vendor = await createSubmittedVendor()

    const rejected = await client
      .post(`/v1/admin/vendors/${vendor.uuid}/tax/reject`)
      .withSession(admin.session)
      .json({ reason: 'Unsigned' })

    rejected.assertStatus(200)
    const data = (rejected.body() as any).data
    assert.equal(data.taxDocument.status, 'rejected')
    assert.equal(data.taxDocument.rejectedReason, 'Unsigned')
    const tax = item(data.checklist, 'tax') as any
    assert.isFalse(tax.complete)
    assert.include(tax.detail, 'Unsigned')
  })

  test('tax endpoints 404 when nothing was uploaded', async ({ client }) => {
    const admin = await signupAs(client, 'admin')
    const vendor = await createVendor()

    await expectStatus(
      client.get(`/v1/admin/vendors/${vendor.uuid}/tax/document`).withSession(admin.session),
      404
    )
    await expectStatus(
      client.post(`/v1/admin/vendors/${vendor.uuid}/tax/verify`).withSession(admin.session),
      404
    )
  })

  test('activation is blocked until every review item is done', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const pla = await createMaterial('PLA', 'fdm')
    const petg = await createMaterial('PETG', 'fdm')
    await createMaterial('Resin', 'sla') // not approved for sla - needs no rate
    const vendor = await createSubmittedVendor()
    const activate = () =>
      client.post(`/v1/admin/vendors/${vendor.uuid}/activate`).withSession(admin.session)

    // Capability still requested, tax unverified, no rates.
    let response = await activate()
    response.assertStatus(422)
    assert.isFalse(item((response.body() as any).adminChecklist, 'capabilities_reviewed').complete)
    assert.isFalse(item((response.body() as any).adminChecklist, 'tax_verified').complete)

    await client
      .patch(`/v1/admin/vendors/${vendor.uuid}/capabilities/fdm`)
      .withSession(admin.session)
      .json({ status: 'approved' })
    await client.post(`/v1/admin/vendors/${vendor.uuid}/tax/verify`).withSession(admin.session)
    await setPayoutRate(vendor, pla, '70.00')

    // Still missing PETG's rate.
    response = await activate()
    response.assertStatus(422)
    const rates = item((response.body() as any).adminChecklist, 'payout_rates') as any
    assert.isFalse(rates.complete)
    assert.include(rates.detail, 'PETG')
    assert.notInclude(rates.detail, 'Resin')

    await setPayoutRate(vendor, petg, '70.00')
    response = await activate()
    response.assertStatus(200)
    assert.equal((response.body() as any).data.status, 'active')
    assert.equal((response.body() as any).data.activatedBy.uuid, admin.user.uuid)

    const vendorEvents = await AuditEvent.query().where('entityType', 'vendor')
    const actions = vendorEvents.map((event) => event.payload.action)
    assert.includeMembers(actions, ['capability_approved', 'tax_document_verified', 'activated'])
  })

  test('only vendors pending review can be activated', async ({ client }) => {
    const admin = await signupAs(client, 'admin')
    const vendor = await createVendor('onboarding')
    await completeVendorChecklist(vendor)
    await completeAdminChecklist(vendor, admin.user)
    await expectStatus(
      client.post(`/v1/admin/vendors/${vendor.uuid}/activate`).withSession(admin.session),
      409
    )
  })

  test('suspends and reinstates', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const vendor = await createVendor('active')

    const suspended = await client
      .post(`/v1/admin/vendors/${vendor.uuid}/suspend`)
      .withSession(admin.session)
      .json({ reason: 'Quality issues' })
    suspended.assertStatus(200)
    assert.equal((suspended.body() as any).data.status, 'suspended')
    assert.equal((suspended.body() as any).data.suspensionReason, 'Quality issues')
    await expectStatus(
      client
        .post(`/v1/admin/vendors/${vendor.uuid}/suspend`)
        .withSession(admin.session)
        .json({ reason: 'Again' }),
      409
    )

    const reinstated = await client
      .post(`/v1/admin/vendors/${vendor.uuid}/reinstate`)
      .withSession(admin.session)
    reinstated.assertStatus(200)
    assert.equal((reinstated.body() as any).data.status, 'active')
    assert.isNull((reinstated.body() as any).data.suspensionReason)
    await expectStatus(
      client.post(`/v1/admin/vendors/${vendor.uuid}/reinstate`).withSession(admin.session),
      409
    )
  })
})
