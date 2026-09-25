import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import drive from '@adonisjs/drive/services/main'
import User from '#models/user'
import Vendor from '#models/vendor'
import VendorTaxDocument from '#models/vendor_tax_document'
import VendorTechnologyCapability from '#models/vendor_technology_capability'
import {
  acceptInviteLink,
  completeVendorChecklist,
  inviteVendor,
  signupAs,
  expectStatus,
} from '#tests/helpers/vendors'

const AGREEMENT_VERSION = '2026-09-01' // .env.test VENDOR_AGREEMENT_VERSION

/** A freshly invited-and-accepted vendor, logged in. */
async function newVendor(client: any) {
  const admin = await signupAs(client, 'admin')
  const link = await inviteVendor(client, admin.session, 'vendor@example.com')
  const accepted = await acceptInviteLink(client, link)
  accepted.assertStatus(200)
  const user = await User.findByOrFail('email', 'vendor@example.com')
  const vendor = await Vendor.findByOrFail('userId', user.id)
  return { session: accepted.session(), vendor, admin }
}

function checklistItem(body: any, key: string) {
  return body.data.checklist.find((entry: { key: string }) => entry.key === key)
}

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'
)

test.group('Vendors | onboarding', (group) => {
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

  test('a new vendor starts with every checklist item incomplete', async ({ client, assert }) => {
    const { session } = await newVendor(client)

    const response = await client.get('/v1/vendor/onboarding').withSession(session)

    response.assertStatus(200)
    const data = (response.body() as any).data
    assert.equal(data.status, 'onboarding')
    assert.isFalse(data.onboardingComplete)
    assert.equal(data.agreement.currentVersion, AGREEMENT_VERSION)
    assert.deepEqual(
      data.checklist.map((entry: { key: string }) => entry.key),
      ['profile', 'address', 'capabilities', 'agreement', 'tax', 'payout_method']
    )
    for (const entry of data.checklist) {
      assert.isFalse(entry.complete, entry.key)
      assert.isString(entry.detail)
    }
  })

  test('non-vendors are refused', async ({ client }) => {
    const customer = await signupAs(client, 'customer')
    await expectStatus(client.get('/v1/vendor/onboarding').withSession(customer.session), 403)
  })

  test('profile needs both a display name and a legal name', async ({ client, assert }) => {
    const { session } = await newVendor(client)

    const partial = await client
      .patch('/v1/vendor/onboarding/profile')
      .withSession(session)
      .json({ displayName: 'Acme Print' })
    partial.assertStatus(200)
    assert.isFalse(checklistItem(partial.body() as any, 'profile').complete)

    const full = await client
      .patch('/v1/vendor/onboarding/profile')
      .withSession(session)
      .json({ legalName: 'Acme Print LLC', phone: '555-0100' })
    full.assertStatus(200)
    assert.isTrue(checklistItem(full.body() as any, 'profile').complete)
    assert.equal((full.body() as any).data.displayName, 'Acme Print')
    assert.equal((full.body() as any).data.phone, '555-0100')
  })

  test('the address item needs a default vendor address', async ({ client, assert }) => {
    const { session } = await newVendor(client)
    const address = {
      recipientName: 'Acme',
      line1: '1 Main St',
      city: 'Oakland',
      state: 'CA',
      postalCode: '94600',
      country: 'US',
    }

    await client.post('/v1/vendor/addresses').withSession(session).json(address)
    let onboarding = await client.get('/v1/vendor/onboarding').withSession(session)
    assert.isFalse(checklistItem(onboarding.body() as any, 'address').complete)

    await client
      .post('/v1/vendor/addresses')
      .withSession(session)
      .json({ ...address, isDefault: true })
    onboarding = await client.get('/v1/vendor/onboarding').withSession(session)
    assert.isTrue(checklistItem(onboarding.body() as any, 'address').complete)
  })

  test('capabilities are requested, re-requested after rejection, and removable', async ({
    client,
    assert,
  }) => {
    const { session, vendor, admin } = await newVendor(client)

    const set = await client
      .put('/v1/vendor/onboarding/capabilities')
      .withSession(session)
      .json({ technologies: ['fdm', 'sla'] })
    set.assertStatus(200)
    assert.deepEqual(
      (set.body() as any).data.capabilities.map((c: any) => [c.technology, c.status]),
      [
        ['fdm', 'requested'],
        ['sla', 'requested'],
      ]
    )
    assert.isTrue(checklistItem(set.body() as any, 'capabilities').complete)

    // Admin approves fdm and rejects sla.
    await client
      .patch(`/v1/admin/vendors/${vendor.uuid}/capabilities/fdm`)
      .withSession(admin.session)
      .json({ status: 'approved' })
    await client
      .patch(`/v1/admin/vendors/${vendor.uuid}/capabilities/sla`)
      .withSession(admin.session)
      .json({ status: 'rejected' })

    // Listing sla again re-requests it; approved fdm stays approved.
    const again = await client
      .put('/v1/vendor/onboarding/capabilities')
      .withSession(session)
      .json({ technologies: ['fdm', 'sla'] })
    assert.deepEqual(
      (again.body() as any).data.capabilities.map((c: any) => [c.technology, c.status]),
      [
        ['fdm', 'approved'],
        ['sla', 'requested'],
      ]
    )

    // Leaving one out removes it.
    const dropped = await client
      .put('/v1/vendor/onboarding/capabilities')
      .withSession(session)
      .json({ technologies: ['sla'] })
    assert.deepEqual(
      (dropped.body() as any).data.capabilities.map((c: any) => c.technology),
      ['sla']
    )
    await expectStatus(
      client
        .put('/v1/vendor/onboarding/capabilities')
        .withSession(session)
        .json({ technologies: [] }),
      422
    )
  })

  test('only the current agreement version can be accepted', async ({ client, assert }) => {
    const { session } = await newVendor(client)

    const stale = await client
      .post('/v1/vendor/onboarding/agreement')
      .withSession(session)
      .json({ version: '2020-01-01' })
    stale.assertStatus(422)

    const current = await client
      .post('/v1/vendor/onboarding/agreement')
      .withSession(session)
      .json({ version: AGREEMENT_VERSION })
    current.assertStatus(200)
    assert.isTrue(checklistItem(current.body() as any, 'agreement').complete)
    assert.equal((current.body() as any).data.agreement.acceptedVersion, AGREEMENT_VERSION)
    assert.isNotNull((current.body() as any).data.agreement.acceptedAt)
  })

  test('the agreement IP is the one the trusted proxy saw, not a client-forged entry', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await newVendor(client)

    // The test client connects over loopback, which is trusted like the ALB:
    // proxy-addr skips it and takes the rightmost untrusted entry - the
    // client IP the proxy appended - never the leftmost, client-supplied one.
    await client
      .post('/v1/vendor/onboarding/agreement')
      .withSession(session)
      .header('X-Forwarded-For', '6.6.6.6, 203.0.113.9')
      .json({ version: AGREEMENT_VERSION })
      .then((response: any) => response.assertStatus(200))

    await vendor.refresh()
    assert.equal(vendor.agreementAcceptedIp, '203.0.113.9')
  })

  test('a bumped agreement version marks the agreement incomplete again', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await newVendor(client)
    vendor.agreementVersion = '2025-01-01'
    await vendor.save()

    const response = await client.get('/v1/vendor/onboarding').withSession(session)

    const agreement = checklistItem(response.body() as any, 'agreement')
    assert.isFalse(agreement.complete)
    assert.include(agreement.detail, 'updated')
  })

  test('uploads a tax form to the private disk as a new current document', async ({
    client,
    assert,
  }) => {
    const disk = drive.fake('s3')
    const { session, vendor } = await newVendor(client)

    const response = await client
      .put('/v1/vendor/onboarding/tax')
      .withSession(session)
      .fields({ taxClassification: 'llc', formType: 'w9' })
      .file('file', PDF, { filename: 'w9.pdf', contentType: 'application/pdf' })

    response.assertStatus(200)
    const data = (response.body() as any).data
    assert.equal(data.taxClassification, 'llc')
    assert.equal(data.taxDocument.formType, 'w9')
    assert.equal(data.taxDocument.status, 'uploaded')
    assert.equal(data.taxDocument.originalName, 'w9.pdf')
    assert.notProperty(data.taxDocument, 'storageKey')
    assert.isTrue(checklistItem(response.body() as any, 'tax').complete)

    const document = await VendorTaxDocument.findByOrFail('uuid', data.taxDocument.uuid)
    assert.equal(document.vendorId, vendor.id)
    assert.match(
      document.storageKey,
      new RegExp(`/vendors/${vendor.uuid}/tax/${document.uuid}\\.pdf$`)
    )
    disk.assertExists(document.storageKey)
  })

  test('only PDFs are accepted as tax forms', async ({ client }) => {
    const { session } = await newVendor(client)

    const response = await client
      .put('/v1/vendor/onboarding/tax')
      .withSession(session)
      .fields({ taxClassification: 'llc', formType: 'w9' })
      .file('file', Buffer.from('not a pdf'), { filename: 'w9.txt', contentType: 'text/plain' })

    response.assertStatus(422)
  })

  test('submitting needs a complete checklist and moves the vendor to review', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await newVendor(client)

    const early = await client.post('/v1/vendor/onboarding/submit').withSession(session)
    early.assertStatus(422)
    assert.lengthOf((early.body() as any).checklist, 6)

    await completeVendorChecklist(vendor)

    const submitted = await client.post('/v1/vendor/onboarding/submit').withSession(session)
    submitted.assertStatus(200)
    assert.equal((submitted.body() as any).data.status, 'pending_review')
    assert.isNotNull((submitted.body() as any).data.submittedAt)
    assert.isTrue((submitted.body() as any).data.onboardingComplete)
    await expectStatus(client.post('/v1/vendor/onboarding/submit').withSession(session), 409)
  })

  test('the profile payload tells the frontend where to send the vendor', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await newVendor(client)

    let profile = await client.get('/v1/account/profile').withSession(session)
    profile.assertStatus(200)
    assert.deepEqual((profile.body() as any).data.vendor, {
      uuid: vendor.uuid,
      status: 'onboarding',
      onboardingComplete: false,
    })

    await completeVendorChecklist(vendor)
    await client.post('/v1/vendor/onboarding/submit').withSession(session)

    profile = await client.get('/v1/account/profile').withSession(session)
    assert.deepEqual((profile.body() as any).data.vendor, {
      uuid: vendor.uuid,
      status: 'pending_review',
      onboardingComplete: true,
    })

    // Non-vendors get null.
    const customer = await signupAs(client, 'customer')
    const customerProfile = await client.get('/v1/account/profile').withSession(customer.session)
    assert.isNull((customerProfile.body() as any).data.vendor)
  })

  test('a suspended vendor cannot change their profile or capabilities', async ({ client }) => {
    const { session, vendor } = await newVendor(client)
    vendor.status = 'suspended'
    await vendor.save()
    await VendorTechnologyCapability.create({
      vendorId: vendor.id,
      technology: 'fdm',
      status: 'approved',
      isPreferred: false,
    })
    await expectStatus(
      client
        .patch('/v1/vendor/onboarding/profile')
        .withSession(session)
        .json({ displayName: 'New Name' }),
      409
    )
    await expectStatus(
      client
        .put('/v1/vendor/onboarding/capabilities')
        .withSession(session)
        .json({ technologies: ['sla'] }),
      409
    )
  })
})
