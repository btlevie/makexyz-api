import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import drive from '@adonisjs/drive/services/main'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import sharp from 'sharp'
import Conversation from '#models/conversation'
import ConversationBlock from '#models/conversation_block'
import Customer from '#models/customer'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import ModerationCase from '#models/moderation_case'
import ModerationEvaluation from '#models/moderation_evaluation'
import type Vendor from '#models/vendor'
import VendorImage from '#models/vendor_image'
import { fakeMalwareScanner } from '#services/attachment_scanner'
import { fakeGeoClient } from '#services/google_geo_client'
import { fakeImageModerator } from '#services/image_moderator'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import { checkVendorImage } from '#services/vendor_image_service'
import { computeResponseStats } from '#services/vendor_response_stats_service'
import { dataOf, listedVendor } from '#tests/helpers/directory'
import {
  activeVendor,
  messagePayload,
  startInquiry,
  verifiedCustomer,
} from '#tests/helpers/messaging'
import { createMaterial } from '#tests/helpers/payouts'
import { expectStatus, signupAs } from '#tests/helpers/vendors'

/** A signed-in active vendor that isn't in the directory yet. */
async function unlistedVendor(client: any, displayName = 'Acme Print') {
  const result = await activeVendor(client, displayName)
  result.vendor.merge({ acceptingInquiries: false, profilePublishedAt: null, profileSlug: null })
  await result.vendor.save()
  return result
}

function patchProfile(client: any, session: any, body: Record<string, unknown>) {
  return client.patch('/v1/vendor/profile').withSession(session).json(body)
}

test.group('Vendor directory | profiles', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    clearRuleConfigCache()
    fakeGeoClient.reset()
    return async () => {
      clearRuleConfigCache()
      fakeGeoClient.reset()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('a vendor publishes a profile and it becomes public', async ({ client, assert }) => {
    const { session, vendor } = await unlistedVendor(client, 'Acme Print')

    const before = await client.get('/v1/vendor/profile').withSession(session)
    before.assertStatus(200)
    assert.isFalse(dataOf(before).listed)
    assert.includeMembers(dataOf(before).notListedBecause, [
      'not_accepting_inquiries',
      'not_published',
    ])

    const response = await patchProfile(client, session, {
      bio: 'Small-batch FDM and SLA printing, usually shipped within three days.',
      acceptingInquiries: true,
      published: true,
    })
    response.assertStatus(200)
    assert.equal(dataOf(response).profileSlug, 'acme-print')
    assert.isTrue(dataOf(response).listed)
    assert.deepEqual(dataOf(response).notListedBecause, [])

    const pub = await client.get('/v1/vendors/acme-print')
    pub.assertStatus(200)
    assert.equal(dataOf(pub).uuid, vendor.uuid)
    assert.equal(
      dataOf(pub).bio,
      'Small-batch FDM and SLA printing, usually shipped within three days.'
    )
    const raw = JSON.stringify(pub.body())
    for (const hidden of ['legalName', 'phone', 'paypal', 'stripe', 'email', 'line1']) {
      assert.notInclude(raw, hidden)
    }

    // An evaluation was recorded against the profile, not a message.
    const evaluation = await ModerationEvaluation.query()
      .where('subjectType', 'vendor_profile')
      .where('subjectId', vendor.id)
      .firstOrFail()
    assert.isNull(evaluation.messageId)

    await patchProfile(client, session, { published: false })
    const gone = await client.get('/v1/vendors/acme-print')
    gone.assertStatus(404)
  })

  test('profile text with contact details is refused and nothing changes', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await unlistedVendor(client)
    const response = await patchProfile(client, session, {
      bio: 'Email me directly at jo.maker@gmail.com for cheaper prices',
    })
    response.assertStatus(422)
    assert.equal(response.body().code, 'moderation_blocked')
    await vendor.refresh()
    assert.isNull(vendor.bio)

    // The onboarding display-name edit is moderated the same way.
    const renamed = await client
      .patch('/v1/vendor/onboarding/profile')
      .withSession(session)
      .json({ displayName: 'Call 415-555-0123' })
    renamed.assertStatus(422)
    await vendor.refresh()
    assert.equal(vendor.displayName, 'Acme Print')
  })

  test('reserved and taken profile addresses are refused', async ({ client }) => {
    const first = await unlistedVendor(client, 'First')
    const second = await unlistedVendor(client, 'Second')
    await expectStatus(patchProfile(client, first.session, { profileSlug: 'acme' }), 200)
    await expectStatus(patchProfile(client, second.session, { profileSlug: 'acme' }), 409)
    await expectStatus(patchProfile(client, second.session, { profileSlug: 'search' }), 422)
    await expectStatus(patchProfile(client, second.session, { profileSlug: 'Not A Slug!' }), 422)
  })

  test("a restricted vendor's text waits for a moderator, who can approve or block it", async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await unlistedVendor(client)
    const { session: adminSession } = await signupAs(client, 'admin')
    await MessagingRiskProfile.create({ vendorId: vendor.id, trustTier: 'restricted' })

    const response = await patchProfile(client, session, {
      bio: 'Precision printing for engineers.',
      acceptingInquiries: true,
      published: true,
    })
    response.assertStatus(200)
    assert.equal(dataOf(response).moderationStatus, 'pending_review')
    assert.isFalse(dataOf(response).listed)
    await expectStatus(client.get(`/v1/vendors/${dataOf(response).profileSlug}`), 404)

    const moderationCase = await ModerationCase.query()
      .where('subjectType', 'vendor_profile')
      .where('subjectId', vendor.id)
      .firstOrFail()
    assert.equal(moderationCase.source, 'auto_hold')
    assert.equal(moderationCase.vendorId, vendor.id)

    const detail = await client
      .get(`/v1/admin/moderation/cases/${moderationCase.uuid}`)
      .withSession(adminSession)
    detail.assertStatus(200)

    const approved = await client
      .post(`/v1/admin/moderation/cases/${moderationCase.uuid}/approve`)
      .withSession(adminSession)
      .json({})
    approved.assertStatus(200)
    await vendor.refresh()
    assert.equal(vendor.profileModerationStatus, 'approved')
    assert.isTrue(vendor.isListed)

    // An edit supersedes the open case; blocking the new one rejects the text.
    await patchProfile(client, session, { bio: 'Precision printing for engineers and makers.' })
    await patchProfile(client, session, { bio: 'Precision printing for makers.' })
    const open = await ModerationCase.query()
      .where('subjectType', 'vendor_profile')
      .where('subjectId', vendor.id)
      .whereNot('status', 'resolved')
    assert.lengthOf(open, 1)
    const blocked = await client
      .post(`/v1/admin/moderation/cases/${open[0].uuid}/block`)
      .withSession(adminSession)
      .json({})
    blocked.assertStatus(200)
    await vendor.refresh()
    assert.equal(vendor.profileModerationStatus, 'rejected')
    assert.isFalse(vendor.isListed)
  })

  test('services and indicative prices show on the profile; an admin can turn a service off', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await unlistedVendor(client)
    const { session: adminSession } = await signupAs(client, 'admin')
    await patchProfile(client, session, { acceptingInquiries: true, published: true })
    const pla = await createMaterial('PLA', 'fdm')

    const services = await client
      .put('/v1/vendor/profile/services')
      .withSession(session)
      .json({
        services: [
          { service: 'design', rate: '85.00', description: 'CAD from sketches.' },
          { service: 'scanning' },
        ],
      })
    services.assertStatus(200)
    const prices = await client
      .put('/v1/vendor/profile/prices')
      .withSession(session)
      .json({ prices: [{ materialUuid: pla.uuid, pricePerCm3: '0.35' }] })
    prices.assertStatus(200)
    assert.equal(Number(dataOf(prices).indicativePrices[0].pricePerCm3), 0.35)

    const pub = await client.get(`/v1/vendors/${vendor.profileSlug ?? 'acme-print'}`)
    pub.assertStatus(200)
    assert.equal(dataOf(pub).priceTier, 1)
    assert.deepEqual(
      // Postgres returns decimals as strings, SQLite (tests) as numbers.
      dataOf(pub).services.map((entry: any) => [
        entry.service,
        entry.rate === null ? null : Number(entry.rate),
        entry.rateUnit,
      ]),
      [
        ['design', 85, 'hour'],
        ['scanning', null, null],
      ]
    )

    const disabled = await client
      .patch(`/v1/admin/vendors/${vendor.uuid}/services/design`)
      .withSession(adminSession)
      .json({ active: false, reason: 'Not a real design service' })
    disabled.assertStatus(200)

    const search = await client.post('/v1/vendors/search').json({ service: 'design' })
    assert.lengthOf(dataOf(search).vendors, 0)

    // The vendor listing it again doesn't override the admin.
    await client
      .put('/v1/vendor/profile/services')
      .withSession(session)
      .json({ services: [{ service: 'design', rate: '85.00', description: 'CAD from sketches.' }] })
    const own = await client.get('/v1/vendor/profile').withSession(session)
    const design = dataOf(own).services.find((entry: any) => entry.service === 'design')
    assert.isTrue(design.disabledByAdmin)
    assert.lengthOf(
      dataOf(await client.post('/v1/vendors/search').json({ service: 'design' })).vendors,
      0
    )
  })

  test('an admin can take a profile out of the directory', async ({ client, assert }) => {
    const { session, vendor } = await unlistedVendor(client)
    const { session: adminSession } = await signupAs(client, 'admin')
    const published = await patchProfile(client, session, {
      acceptingInquiries: true,
      published: true,
    })
    const slug = dataOf(published).profileSlug

    const response = await client
      .post(`/v1/admin/vendors/${vendor.uuid}/profile/unpublish`)
      .withSession(adminSession)
      .json({ reason: 'Misleading claims' })
    response.assertStatus(200)
    assert.isNull(dataOf(response).publishedAt)
    await expectStatus(client.get(`/v1/vendors/${slug}`), 404)

    const vendorSession = await client
      .post(`/v1/admin/vendors/${vendor.uuid}/profile/unpublish`)
      .withSession(session)
      .json({})
    vendorSession.assertStatus(403)
  })

  test('only listed vendors take inquiries', async ({ client, assert }) => {
    const customer = await verifiedCustomer(client)
    const { vendor } = await unlistedVendor(client)
    const response = await startInquiry(client, customer.session, vendor)
    response.assertStatus(422)
    assert.include(JSON.stringify(response.body()), 'not taking inquiries')
  })

  test('onboarding shows the optional profile items', async ({ client, assert }) => {
    const { session } = await unlistedVendor(client)
    const response = await client.get('/v1/vendor/onboarding').withSession(session)
    response.assertStatus(200)
    assert.deepEqual(
      dataOf(response).optionalChecklist.map((item: any) => [item.key, item.complete]),
      [
        ['public_profile', false],
        ['accepting_inquiries', false],
      ]
    )
  })
})

test.group('Vendor directory | images', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    drive.fake('s3')
    clearRuleConfigCache()
    fakeMalwareScanner.reset()
    fakeImageModerator.reset()
    return async () => {
      drive.restore('s3')
      clearRuleConfigCache()
      fakeMalwareScanner.reset()
      fakeImageModerator.reset()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  async function png(color = '#336699') {
    return sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
      .png()
      .toBuffer()
  }

  /** Presign, "PUT" to quarantine, confirm - then run the checks the job would. */
  async function uploadImage(
    client: any,
    session: any,
    kind: 'profile' | 'portfolio',
    bytes: Buffer
  ) {
    const created = await client
      .post('/v1/vendor/profile/images')
      .withSession(session)
      .json({ kind, fileName: 'work.png', sizeBytes: bytes.length })
    created.assertStatus(201)
    const image = await VendorImage.findByOrFail('uuid', dataOf(created).image.uuid)
    await drive.use('s3').put(image.quarantineKey, bytes)
    const completed = await client
      .post(`/v1/vendor/profile/images/${image.uuid}/complete`)
      .withSession(session)
    completed.assertStatus(200)
    await checkVendorImage(image.id)
    await image.refresh()
    return image
  }

  test('a clean image is re-encoded, published and shown on the profile', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await activeVendor(client)
    const image = await uploadImage(client, session, 'portfolio', await png())

    assert.equal(image.status, 'approved')
    assert.match(image.storageKey!, /\/public\/vendors\/.+\.webp$/)
    assert.isTrue(await drive.use('s3').exists(image.storageKey!))
    assert.isTrue(await drive.use('s3').exists(image.thumbnailKey!))
    assert.isFalse(await drive.use('s3').exists(image.quarantineKey))
    assert.equal(fakeImageModerator.calls, 1)

    const pub = await client.get(`/v1/vendors/${vendor.profileSlug}`)
    pub.assertStatus(200)
    assert.lengthOf(dataOf(pub).portfolio, 1)
    assert.equal(dataOf(pub).portfolio[0].uuid, image.uuid)
    assert.notInclude(JSON.stringify(pub.body()), 'quarantine')
  })

  test('Rekognition labels reject an image, which is never served', async ({ client, assert }) => {
    const { session, vendor } = await activeVendor(client)
    fakeImageModerator.nextLabels = [
      { name: 'Explicit Nudity', parent: 'Explicit', confidence: 98 },
    ]
    const image = await uploadImage(client, session, 'portfolio', await png())

    assert.equal(image.status, 'rejected')
    assert.equal(image.rejectReason, 'image_explicit')
    assert.isNull(image.storageKey)
    const pub = await client.get(`/v1/vendors/${vendor.profileSlug}`)
    assert.lengthOf(dataOf(pub).portfolio, 0)
  })

  test('an image the checks could not vouch for waits for a moderator', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await activeVendor(client)
    const { session: adminSession } = await signupAs(client, 'admin')
    fakeImageModerator.available = false
    const image = await uploadImage(client, session, 'portfolio', await png())

    assert.equal(image.status, 'review')
    assert.equal(image.rejectReason, 'image_moderation_unavailable')
    const pub = await client.get(`/v1/vendors/${vendor.profileSlug}`)
    assert.lengthOf(dataOf(pub).portfolio, 0)

    const view = await client.get(`/v1/admin/vendor-images/${image.uuid}`).withSession(adminSession)
    view.assertStatus(200)
    assert.isString(dataOf(view).url)

    const moderationCase = await ModerationCase.query()
      .where('subjectType', 'vendor_image')
      .where('subjectId', image.id)
      .firstOrFail()
    const approved = await client
      .post(`/v1/admin/moderation/cases/${moderationCase.uuid}/approve`)
      .withSession(adminSession)
      .json({})
    approved.assertStatus(200)
    await image.refresh()
    assert.equal(image.status, 'approved')
  })

  test('a new profile photo replaces the old one once approved', async ({ client, assert }) => {
    const { session, vendor } = await activeVendor(client)
    const first = await uploadImage(client, session, 'profile', await png('#ff0000'))
    const second = await uploadImage(client, session, 'profile', await png('#00ff00'))

    assert.equal(second.status, 'approved')
    assert.isNull(await VendorImage.find(first.id))
    assert.isFalse(await drive.use('s3').exists(first.storageKey!))
    const pub = await client.get(`/v1/vendors/${vendor.profileSlug}`)
    assert.equal(dataOf(pub).profileImage.uuid, second.uuid)
  })

  test('uploads are limited by type, size and portfolio count', async ({ client }) => {
    const { session, vendor } = await activeVendor(client)
    const bad = await client
      .post('/v1/vendor/profile/images')
      .withSession(session)
      .json({ kind: 'portfolio', fileName: 'model.stl', sizeBytes: 100 })
    bad.assertStatus(422)
    const huge = await client
      .post('/v1/vendor/profile/images')
      .withSession(session)
      .json({ kind: 'portfolio', fileName: 'big.png', sizeBytes: 11 * 1024 * 1024 })
    huge.assertStatus(422)

    for (let i = 0; i < 12; i++) {
      await VendorImage.create({
        uuid: string.uuid(),
        vendorId: vendor.id,
        kind: 'portfolio',
        quarantineKey: `q/${i}.png`,
        extname: 'png',
        sizeBytes: 10,
        position: i,
        status: 'approved',
      })
    }
    const full = await client
      .post('/v1/vendor/profile/images')
      .withSession(session)
      .json({ kind: 'portfolio', fileName: 'one-more.png', sizeBytes: 100 })
    full.assertStatus(409)
  })
})

test.group('Vendor directory | response stats', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    clearRuleConfigCache()
    return async () => {
      clearRuleConfigCache()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  async function inquiry(
    vendor: Vendor,
    deliveredDaysAgo: number,
    respondedAfterHours: number | null
  ) {
    const customer = await Customer.create({ uuid: string.uuid() })
    const deliveredAt = DateTime.now().minus({ days: deliveredDaysAgo })
    return Conversation.create({
      uuid: string.uuid(),
      kind: 'inquiry',
      customerId: customer.id,
      vendorId: vendor.id,
      status: 'read_only',
      firstCustomerMessageDeliveredAt: deliveredAt,
      firstVendorResponseAt:
        respondedAfterHours === null ? null : deliveredAt.plus({ hours: respondedAfterHours }),
    })
  }

  test('counts answers within 7 days, skips young unanswered inquiries, and takes the median of the last 6', async ({
    assert,
  }) => {
    const vendor = await listedVendor()
    await inquiry(vendor, 30, 2)
    await inquiry(vendor, 25, 4)
    await inquiry(vendor, 20, 10)
    await inquiry(vendor, 15, 24 * 9) // answered, but too late
    await inquiry(vendor, 12, null) // never answered
    await inquiry(vendor, 2, null) // still inside its window - not counted
    await inquiry(vendor, 120, 1) // outside the 90-day window

    const stats = await computeResponseStats(vendor.id)
    assert.equal(stats.counted, 5)
    assert.equal(stats.responseRate, 60)
    // Answered: 2h, 4h, 10h, 216h -> median 7h.
    assert.equal(stats.responseTimeHours, 7)
  })

  test("inquiries from customers the vendor blocked don't count", async ({ assert }) => {
    const vendor = await listedVendor()
    await inquiry(vendor, 20, 1)
    const ignored = await inquiry(vendor, 20, null)
    await ConversationBlock.create({ vendorId: vendor.id, customerId: ignored.customerId! })

    const stats = await computeResponseStats(vendor.id)
    assert.equal(stats.counted, 1)
    assert.equal(stats.responseRate, 100)
  })

  test('a reply or a decline updates the cached stats', async ({ client, assert }) => {
    const customer = await verifiedCustomer(client)
    const { session, vendor } = await activeVendor(client)
    const started = await startInquiry(client, customer.session, vendor)
    started.assertStatus(201)
    const uuid = dataOf(started).conversation.uuid

    const reply = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(session)
      .json(messagePayload('Yes, PETG works well for brackets.'))
    reply.assertStatus(201)
    await vendor.refresh()
    assert.isNotNull(vendor.responseStatsAt)
    assert.equal(vendor.responseTimeHours, 0)

    const other = await verifiedCustomer(client)
    const second = await startInquiry(client, other.session, vendor)
    const declined = await client
      .post(`/v1/vendor/conversations/${dataOf(second).conversation.uuid}/decline`)
      .withSession(session)
      .json({})
    declined.assertStatus(204)
    await vendor.refresh()
    // Both answered at once; neither is past its window, so both count.
    assert.equal(vendor.responseRate, 100)
  })
})
