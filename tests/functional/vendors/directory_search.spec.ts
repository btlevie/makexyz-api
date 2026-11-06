import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import PlaceCoordinate from '#models/place_coordinate'
import SearchEvent from '#models/search_event'
import ServiceLocation from '#models/service_location'
import ServiceLocationPostalCode from '#models/service_location_postal_code'
import Vendor from '#models/vendor'
import VendorService from '#models/vendor_service'
import { fakeGeoClient } from '#services/google_geo_client'
import { refreshPlaceCoordinates, refreshPlaceIds } from '#services/geocoding_service'
import { purgeSearchEventCoordinates } from '#services/search_analytics_service'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import { CITIES, dataOf, listedVendor, placeIdFor } from '#tests/helpers/directory'
import { createMaterial, setPayoutRate } from '#tests/helpers/payouts'

const AUSTIN_POINT = { lat: CITIES.austin.lat, lng: CITIES.austin.lng }

function search(client: any, body: Record<string, unknown>) {
  return client.post('/v1/vendors/search').json(body)
}

function uuidsOf(response: any): string[] {
  return dataOf(response).vendors.map((vendor: { uuid: string }) => vendor.uuid)
}

test.group('Vendor directory | search', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    fakeGeoClient.reset()
    clearRuleConfigCache()
    return async () => {
      fakeGeoClient.reset()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('ranks vendors nearest the searched point first, without exposing locations', async ({
    client,
    assert,
  }) => {
    const seattle = await listedVendor({ city: 'seattle' })
    const dallas = await listedVendor({ city: 'dallas' })
    const austin = await listedVendor({ city: 'austin' })

    const response = await search(client, { ...AUSTIN_POINT, placeId: placeIdFor('austin') })
    response.assertStatus(200)
    assert.deepEqual(uuidsOf(response), [austin.uuid, dallas.uuid, seattle.uuid])

    const [first, second] = dataOf(response).vendors
    assert.deepEqual(first.location, { city: 'Austin', state: 'TX', country: 'US' })
    assert.deepEqual(first.distance, { miles: 0, km: 0 })
    assert.closeTo(second.distance.km, 293, 5)
    assert.deepEqual(first.services, ['printing'])

    // No coordinates, street address, place IDs or private vendor details anywhere.
    const raw = JSON.stringify(response.body())
    for (const secret of ['742 Evergreen', 'Secret Legal', '+1512', '"lat"', '"lng"', 'place-']) {
      assert.notInclude(raw, secret)
    }
    assert.equal(dataOf(response).location.matched.slug, 'austin-tx')
    assert.deepEqual(dataOf(response).meta, { total: 3, page: 1, perPage: 20 })
  })

  test('only listed vendors appear', async ({ client, assert }) => {
    const listed = await listedVendor()
    const hidden = await Promise.all([
      listedVendor().then((v) => v.merge({ acceptingInquiries: false }).save()),
      listedVendor().then((v) => v.merge({ profilePublishedAt: null }).save()),
      listedVendor().then((v) => v.merge({ profileModerationStatus: 'pending_review' }).save()),
      listedVendor().then((v) => v.merge({ profileModerationStatus: 'rejected' }).save()),
      listedVendor().then((v) => v.merge({ status: 'suspended' }).save()),
      listedVendor().then((v) => v.merge({ status: 'pending_review' }).save()),
    ])
    assert.lengthOf(hidden, 6)

    const response = await search(client, {})
    response.assertStatus(200)
    assert.deepEqual(uuidsOf(response), [listed.uuid])
  })

  test('filters by technology, material and service', async ({ client, assert }) => {
    const pla = await createMaterial('PLA', 'fdm')
    const fdm = await listedVendor({ technologies: ['fdm'] })
    await setPayoutRate(fdm, pla, '70.00')
    const sla = await listedVendor({ technologies: ['sla'] })
    const designer = await listedVendor({ technologies: ['fdm'] })
    await VendorService.create({ vendorId: designer.id, service: 'design', active: true })
    // A payout rate alone isn't enough - the technology must be approved too.
    await setPayoutRate(sla, pla, '70.00')

    const byTechnology = await search(client, { technology: 'sla' })
    assert.deepEqual(uuidsOf(byTechnology), [sla.uuid])

    const byMaterial = await search(client, { materialUuid: pla.uuid })
    assert.deepEqual(uuidsOf(byMaterial), [fdm.uuid])

    const byService = await search(client, { service: 'design' })
    assert.deepEqual(uuidsOf(byService), [designer.uuid])
    assert.deepEqual(dataOf(byService).vendors[0].services, ['printing', 'design'])

    const printing = await search(client, { service: 'printing' })
    assert.sameMembers(uuidsOf(printing), [fdm.uuid, sla.uuid, designer.uuid])

    const unknown = await search(client, { materialUuid: '00000000-0000-4000-8000-000000000000' })
    unknown.assertStatus(422)
  })

  test('without a location, reputation alone decides', async ({ client, assert }) => {
    const slow = await listedVendor({ city: 'austin', responseRate: 50 })
    const prompt = await listedVendor({ city: 'seattle', responseRate: 100 })
    const reviewed = await listedVendor({
      city: 'dallas',
      ratingCount: 100,
      ratingAverage: '5.00',
      responseRate: 100,
    })

    const response = await search(client, {})
    assert.deepEqual(uuidsOf(response), [reviewed.uuid, prompt.uuid, slow.uuid])
    assert.isFalse(dataOf(response).location.ranked)
    assert.isNull(dataOf(response).vendors[0].distance)
  })

  test('a newcomer is inserted at position 5 on the first unfiltered page', async ({
    client,
    assert,
  }) => {
    const rated = []
    for (let i = 0; i < 5; i++) {
      rated.push(await listedVendor({ ratingCount: 100, ratingAverage: '5.00', responseRate: 100 }))
    }
    const newcomer = await listedVendor({ city: 'roundRock' })

    const first = await search(client, { ...AUSTIN_POINT, perPage: 4 })
    const cards = dataOf(first).vendors
    assert.lengthOf(cards, 5)
    assert.equal(cards[4].uuid, newcomer.uuid)
    assert.isTrue(cards[4].featuredNewcomer)
    assert.isTrue(cards.slice(0, 4).every((card: any) => !card.featuredNewcomer))

    // Pages are stable and don't overlap; the newcomer also shows in its own place.
    const second = await search(client, { ...AUSTIN_POINT, perPage: 4, page: 2 })
    const pageOne = cards.slice(0, 4).map((card: any) => card.uuid)
    const pageTwo = uuidsOf(second)
    assert.lengthOf(pageTwo, 2)
    assert.sameMembers([...pageOne, ...pageTwo], [...rated.map((v) => v.uuid), newcomer.uuid])
    assert.isTrue(dataOf(second).vendors.every((card: any) => !card.featuredNewcomer))

    // Filtered searches get no newcomer.
    const filtered = await search(client, { ...AUSTIN_POINT, perPage: 4, technology: 'fdm' })
    assert.lengthOf(dataOf(filtered).vendors, 4)
  })

  test('maxDistanceMiles leaves out vendors further away or without a location', async ({
    client,
    assert,
  }) => {
    const near = await listedVendor({ city: 'roundRock' })
    await listedVendor({ city: 'dallas' })
    await listedVendor({ geocode: false })

    const response = await search(client, { ...AUSTIN_POINT, maxDistanceMiles: 50 })
    assert.deepEqual(uuidsOf(response), [near.uuid])
  })

  test('vendors whose cached coordinates expired rank on reputation alone', async ({
    client,
    assert,
  }) => {
    const austin = await listedVendor({ city: 'austin' })
    await PlaceCoordinate.query()
      .where('placeId', placeIdFor('austin'))
      .update({ expires_at: DateTime.now().minus({ minutes: 1 }).toSQL() })

    const response = await search(client, AUSTIN_POINT)
    assert.deepEqual(uuidsOf(response), [austin.uuid])
    assert.isNull(dataOf(response).vendors[0].distance)
  })

  test('vendors in one city share a coordinate row and a city page', async ({ assert }) => {
    const first = await listedVendor({ city: 'austin' })
    const second = await listedVendor({ city: 'austin' })
    assert.equal(first.placeId, placeIdFor('austin'))
    assert.equal(second.placeId, placeIdFor('austin'))
    assert.equal(first.geocodeStatus, 'ok')

    assert.lengthOf(await PlaceCoordinate.all(), 1)
    const pages = await ServiceLocation.all()
    assert.lengthOf(pages, 1)
    assert.containSubset(pages[0].$attributes, {
      slug: 'austin-tx',
      city: 'Austin',
      state: 'TX',
      isIndexable: false,
    })
    const postal = await ServiceLocationPostalCode.findByOrFail('postalCode', '78701')
    assert.equal(postal.serviceLocationId, pages[0].id)
  })

  test("a vendor whose city Google doesn't know isn't located", async ({ assert }) => {
    const vendor = await listedVendor({ geocode: false })
    const { geocodeVendor } = await import('#services/geocoding_service')
    await geocodeVendor(vendor)
    assert.equal(vendor.geocodeStatus, 'not_found')
    assert.isNull(vendor.placeId)
    assert.equal(vendor.locationCity, 'Austin')
  })

  test('the daily refresh keeps coordinates inside the 30-day window', async ({ assert }) => {
    await listedVendor({ city: 'austin' })
    await PlaceCoordinate.query()
      .where('placeId', placeIdFor('austin'))
      .update({ expires_at: DateTime.now().plus({ days: 2 }).toSQL() })
    await PlaceCoordinate.create({
      placeId: 'place-unused',
      lat: 1,
      lng: 1,
      refreshedAt: DateTime.now().minus({ days: 31 }),
      expiresAt: DateTime.now().minus({ days: 1 }),
    })

    const result = await refreshPlaceCoordinates()
    assert.equal(result.refreshed, 1)
    assert.equal(result.deleted, 1)

    const row = await PlaceCoordinate.findByOrFail('placeId', placeIdFor('austin'))
    assert.isAbove(row.expiresAt.diffNow('days').days, 29)
    assert.isAtMost(row.expiresAt.diffNow('days').days, 30)
    assert.isNull(await PlaceCoordinate.findBy('placeId', 'place-unused'))
  })

  test('place IDs older than 12 months are refreshed, and a changed ID moves everywhere', async ({
    assert,
  }) => {
    const vendor = await listedVendor({ city: 'austin' })
    await Vendor.query()
      .where('id', vendor.id)
      .update({ place_id_refreshed_at: DateTime.now().minus({ months: 13 }).toSQL() })
    const place = fakeGeoClient.places.get(placeIdFor('austin'))!
    fakeGeoClient.places.set('place-austin-v2', { ...place, placeId: 'place-austin-v2' })
    fakeGeoClient.renamed.set(placeIdFor('austin'), 'place-austin-v2')

    const result = await refreshPlaceIds()
    assert.equal(result.replaced, 1)
    await vendor.refresh()
    assert.equal(vendor.placeId, 'place-austin-v2')
    const page = await ServiceLocation.findByOrFail('slug', 'austin-tx')
    assert.equal(page.placeId, 'place-austin-v2')
    assert.isTrue(fakeGeoClient.calls.includes('refreshPlaceId'))
  })
})

test.group('Vendor directory | city pages', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    fakeGeoClient.reset()
    return async () => {
      fakeGeoClient.reset()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  async function austinPage() {
    await listedVendor({ city: 'austin' })
    return ServiceLocation.findByOrFail('slug', 'austin-tx')
  }

  test('resolves a city pick by its place ID', async ({ client, assert }) => {
    await austinPage()
    const response = await search(client, { ...AUSTIN_POINT, placeId: placeIdFor('austin') })
    assert.equal(dataOf(response).location.matched.slug, 'austin-tx')
    assert.notInclude(fakeGeoClient.calls, 'reverseGeocode')
  })

  test('resolves an address pick by its postal code', async ({ client, assert }) => {
    await austinPage()
    const response = await search(client, {
      ...AUSTIN_POINT,
      placeId: 'some-street-address',
      postalCode: '78701',
      country: 'US',
    })
    assert.equal(dataOf(response).location.matched.slug, 'austin-tx')
  })

  test('resolves by city, state and country', async ({ client, assert }) => {
    await austinPage()
    const response = await search(client, { city: 'austin', state: 'tx', country: 'us' })
    assert.equal(dataOf(response).location.matched.slug, 'austin-tx')
    // No coordinates given: ranked around the city page's center.
    assert.isTrue(dataOf(response).location.ranked)
  })

  test('falls back to a reverse geocode, and learns the postal code', async ({
    client,
    assert,
  }) => {
    await austinPage()
    fakeGeoClient.addPoint(30.3, -97.75, {
      locality: fakeGeoClient.places.get(placeIdFor('austin'))!,
      postalCode: '78705',
      city: 'Austin',
      state: 'TX',
      country: 'US',
    })

    const response = await search(client, { lat: 30.3, lng: -97.75 })
    assert.equal(dataOf(response).location.matched.slug, 'austin-tx')
    assert.equal(dataOf(response).location.postalCode, '78705')
    assert.isNotNull(await ServiceLocationPostalCode.findBy('postalCode', '78705'))

    // Next time the postal code alone resolves it - no Google call.
    fakeGeoClient.calls.length = 0
    await search(client, { lat: 30.3, lng: -97.75, postalCode: '78705', country: 'US' })
    assert.notInclude(fakeGeoClient.calls, 'reverseGeocode')
  })

  test('with no city page, vendors are still ranked around the point and the nearest indexable page is canonical', async ({
    client,
    assert,
  }) => {
    const page = await austinPage()
    page.isIndexable = true
    await page.save()
    fakeGeoClient.addPoint(31.549, -97.146, {
      locality: null,
      postalCode: '76701',
      city: 'Waco',
      state: 'TX',
      country: 'US',
    })

    const response = await search(client, { lat: 31.549, lng: -97.146 })
    const location = dataOf(response).location
    assert.isNull(location.matched)
    assert.equal(location.city, 'Waco')
    assert.equal(location.canonical.slug, 'austin-tx')
    assert.closeTo(dataOf(response).vendors[0].distance.miles, 90, 10)
  })

  test('searches a city page by slug, and 404s an unknown one', async ({ client, assert }) => {
    await austinPage()
    const response = await search(client, { locationSlug: 'austin-tx' })
    response.assertStatus(200)
    assert.deepEqual(dataOf(response).vendors[0].distance, { miles: 0, km: 0 })

    const missing = await search(client, { locationSlug: 'atlantis-xx' })
    missing.assertStatus(404)
  })

  test('lists indexable city pages and shows any page with its canonical target', async ({
    client,
    assert,
  }) => {
    const austin = await austinPage()
    austin.isIndexable = true
    await austin.save()
    await listedVendor({ city: 'roundRock' })

    const index = await client.get('/v1/locations')
    index.assertStatus(200)
    assert.deepEqual(
      dataOf(index).map((page: any) => page.slug),
      ['austin-tx']
    )

    const small = await client.get('/v1/locations/round-rock-tx')
    small.assertStatus(200)
    assert.equal(dataOf(small).location.slug, 'round-rock-tx')
    assert.isFalse(dataOf(small).location.isIndexable)
    assert.equal(dataOf(small).nearestIndexable.slug, 'austin-tx')

    const missing = await client.get('/v1/locations/nowhere-zz')
    missing.assertStatus(404)
  })
})

test.group('Vendor directory | search logging', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    fakeGeoClient.reset()
    return async () => {
      fakeGeoClient.reset()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('records each first-page search with the matched city page and rounded coordinates', async ({
    client,
    assert,
  }) => {
    await listedVendor({ city: 'austin' })
    await search(client, {
      lat: 30.267153,
      lng: -97.743061,
      placeId: placeIdFor('austin'),
      city: 'Austin',
      state: 'TX',
      country: 'US',
      query: 'Austin, TX',
      service: 'printing',
      sessionKey: 'session-1',
    })
    await search(client, { ...AUSTIN_POINT, page: 2 })

    const events = await SearchEvent.all()
    assert.lengthOf(events, 1)
    const [event] = events
    const page = await ServiceLocation.findByOrFail('slug', 'austin-tx')
    assert.containSubset(event.$attributes, {
      rawQuery: 'Austin, TX',
      matchedLocationId: page.id,
      canonicalLocationId: null,
      service: 'printing',
      resultCount: 1,
      sessionKey: 'session-1',
      lat: 30.27,
      lng: -97.74,
    })
  })

  test("a logging failure doesn't fail the search", async ({ client, assert }) => {
    await listedVendor()
    const create = SearchEvent.create
    SearchEvent.create = (async () => {
      throw new Error('database unavailable')
    }) as typeof SearchEvent.create
    try {
      const response = await search(client, {})
      response.assertStatus(200)
      assert.lengthOf(dataOf(response).vendors, 1)
    } finally {
      SearchEvent.create = create
    }
  })

  test('coordinates are nulled after 30 days', async ({ assert }) => {
    const old = await SearchEvent.create({ lat: 30.27, lng: -97.74, resultCount: 0 })
    const recent = await SearchEvent.create({ lat: 30.27, lng: -97.74, resultCount: 0 })
    await SearchEvent.query()
      .where('id', old.id)
      .update({ created_at: DateTime.now().minus({ days: 31 }).toSQL() })

    assert.equal(await purgeSearchEventCoordinates(), 1)
    await old.refresh()
    await recent.refresh()
    assert.isNull(old.lat)
    assert.equal(recent.lat, 30.27)
  })

  test('records landing visits, marking our own referrers as internal', async ({
    client,
    assert,
  }) => {
    const outside = await client.post('/v1/analytics/landing-visits').json({
      path: '/3dprinters/austin-tx',
      referrer: 'https://www.google.com/',
      sessionKey: 's1',
    })
    outside.assertStatus(204)
    await client
      .post('/v1/analytics/landing-visits')
      .json({ path: '/3dprinters/austin-tx', referrer: 'https://www.makexyz.com/search' })

    const { default: LandingPageVisit } = await import('#models/landing_page_visit')
    const visits = await LandingPageVisit.query().orderBy('id', 'asc')
    assert.deepEqual(
      visits.map((visit) => visit.isInternalReferrer),
      [false, true]
    )

    const invalid = await client.post('/v1/analytics/landing-visits').json({ path: 'no-slash' })
    invalid.assertStatus(422)
  })
})
