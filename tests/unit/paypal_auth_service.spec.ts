import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  getPayPalAccessToken,
  resetPayPalAccessTokenCache,
  setPayPalAccessTokenCacheForTesting,
} from '#services/paypal_auth_service'

test.group('PayPal auth service - token caching', (group) => {
  const originalFetch = globalThis.fetch
  let fetchCallCount = 0

  group.each.setup(() => {
    resetPayPalAccessTokenCache()
    fetchCallCount = 0
    globalThis.fetch = (async () => {
      fetchCallCount += 1
      return {
        ok: true,
        json: async () => ({ access_token: `token-${fetchCallCount}`, expires_in: 3600 }),
      } as Response
    }) as typeof fetch

    return () => {
      globalThis.fetch = originalFetch
      resetPayPalAccessTokenCache()
    }
  })

  test('a second call within the cached window reuses the token, no fetch', async ({
    assert,
  }) => {
    const first = await getPayPalAccessToken()
    const second = await getPayPalAccessToken()

    assert.equal(first, second)
    assert.equal(fetchCallCount, 1)
  })

  test('a call after the cached token has expired fetches a new one', async ({ assert }) => {
    setPayPalAccessTokenCacheForTesting({
      accessToken: 'stale-token',
      expiresAt: DateTime.now().minus({ seconds: 10 }),
    })

    const token = await getPayPalAccessToken()

    assert.equal(fetchCallCount, 1)
    assert.notEqual(token, 'stale-token')
  })

  test('no cached token at all fetches one', async ({ assert }) => {
    const token = await getPayPalAccessToken()

    assert.equal(fetchCallCount, 1)
    assert.equal(token, 'token-1')
  })
})
