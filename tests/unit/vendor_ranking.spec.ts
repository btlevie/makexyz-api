import { test } from '@japa/runner'
import { classify } from '#services/image_moderator'
import {
  haversineKm,
  priceTier,
  proximity,
  ratingTier,
  reputation,
  responseTimeGroup,
  roundCoordinate,
  score,
  volume,
} from '#services/vendor_ranking'

/**
 * The legacy ranking (xyz/search/mysql_backend.py) with the volume bonus
 * fixed - see vendor_ranking.ts and docs/plans/manual_quotes.md, 2a.
 */
test.group('Vendor ranking', () => {
  test('rating tiers follow the rounded average, and unrated is 1.05', ({ assert }) => {
    assert.equal(ratingTier(4.6, 10), 1.2)
    assert.equal(ratingTier(4.4, 10), 1.13)
    assert.equal(ratingTier(3.4, 10), 0.9)
    assert.equal(ratingTier(1, 10), 0.9)
    assert.equal(ratingTier(null, 0), 1.05)
    assert.equal(ratingTier(5, 0), 1.05)
  })

  test('the volume bonus works: 100 five-star reviews outrank one', ({ assert }) => {
    assert.equal(volume(0), 1)
    assert.closeTo(volume(1), 1.01, 1e-9)
    assert.equal(volume(100), 1.5)
    assert.equal(volume(500), 1.5)

    const many = reputation({ ratingAverage: 5, ratingCount: 100, responseRate: null })
    const one = reputation({ ratingAverage: 5, ratingCount: 1, responseRate: null })
    assert.closeTo(many, 1.2 * 1.125, 1e-9)
    assert.closeTo(one, 1.2 * (1 + 0.01 / 4), 1e-9)
    assert.isAbove(many, one)
  })

  test('an unrated vendor gets 1.05, and a 50% response rate halves reputation', ({ assert }) => {
    assert.closeTo(
      reputation({ ratingAverage: null, ratingCount: 0, responseRate: null }),
      1.05,
      1e-9
    )
    const full = reputation({ ratingAverage: 5, ratingCount: 20, responseRate: 100 })
    const half = reputation({ ratingAverage: 5, ratingCount: 20, responseRate: 50 })
    assert.closeTo(half, full / 2, 1e-9)
  })

  test('proximity is 1 within 10 km, halves every 1,000 km beyond, and 0 without a location', ({
    assert,
  }) => {
    assert.equal(proximity(0), 1)
    assert.equal(proximity(10), 1)
    assert.closeTo(proximity(1010), 0.5, 1e-9)
    assert.closeTo(proximity(2010), 0.25, 1e-9)
    assert.equal(proximity(null), 0)
  })

  test('score is 10 x (reputation + proximity)', ({ assert }) => {
    assert.closeTo(
      score({ ratingAverage: null, ratingCount: 0, responseRate: null, distanceKm: 10 }),
      20.5,
      1e-9
    )
    assert.closeTo(
      score({ ratingAverage: null, ratingCount: 0, responseRate: null, distanceKm: null }),
      10.5,
      1e-9
    )
    // 0% response and no location: below the floor of 1, so dropped by the search.
    assert.equal(score({ ratingAverage: 5, ratingCount: 3, responseRate: 0, distanceKm: null }), 0)
  })

  test('haversine distance between real cities', ({ assert }) => {
    const austin = { lat: 30.2672, lng: -97.7431 }
    const dallas = { lat: 32.7767, lng: -96.797 }
    assert.closeTo(haversineKm(austin, dallas), 293, 3)
    assert.equal(haversineKm(austin, austin), 0)
  })

  test('price tiers use the legacy thresholds', ({ assert }) => {
    assert.isNull(priceTier(null))
    assert.equal(priceTier(0.2), 1)
    assert.equal(priceTier(0.49), 2)
    assert.equal(priceTier(1.2), 2)
    assert.equal(priceTier(3), 3)
    assert.equal(priceTier(3.24), 4)
    assert.equal(priceTier(10), 4)
  })

  test('response time groups', ({ assert }) => {
    assert.isNull(responseTimeGroup(null))
    assert.equal(responseTimeGroup(2), 'within_hours')
    assert.equal(responseTimeGroup(6), 'within_hours')
    assert.equal(responseTimeGroup(20), 'within_a_day')
    assert.equal(responseTimeGroup(72), 'a_few_days')
  })

  test('coordinates are rounded for searches and logs', ({ assert }) => {
    assert.equal(roundCoordinate(30.267153, 3), 30.267)
    assert.equal(roundCoordinate(-97.743061, 2), -97.74)
  })
})

test.group('Vendor image moderation labels', () => {
  test('confident labels in a rejected category reject; others pass', ({ assert }) => {
    const rejected = classify([{ name: 'Weapons', parent: 'Violence', confidence: 91 }])
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.status === 'rejected' && rejected.reason, 'image_violence')

    assert.equal(
      classify([{ name: 'Weapons', parent: 'Violence', confidence: 60 }]).status,
      'clean'
    )
    assert.equal(
      classify([{ name: 'Alcoholic Beverages', parent: 'Alcohol', confidence: 99 }]).status,
      'clean'
    )
    assert.equal(classify([]).status, 'clean')
  })
})
