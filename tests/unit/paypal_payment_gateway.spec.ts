import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { PaymentGatewayError } from '#services/payment_gateway_service'
import { PayPalPaymentGateway } from '#services/paypal_payment_gateway'
import {
  resetPayPalAccessTokenCache,
  setPayPalAccessTokenCacheForTesting,
} from '#services/paypal_auth_service'

const QUOTE_UUID = 'quote-uuid-1'
const ORDER_ID = 'PAYPAL-ORDER-1'

type Call = { method: string; path: string; body: any }

/** An approved AUTHORIZE order for QUOTE_UUID at `value`, with overrides. */
function approvedOrder(overrides: Record<string, any> = {}, unit: Record<string, any> = {}) {
  return {
    id: ORDER_ID,
    intent: 'AUTHORIZE',
    status: 'APPROVED',
    purchase_units: [
      { custom_id: QUOTE_UUID, amount: { currency_code: 'USD', value: '139.32' }, ...unit },
    ],
    ...overrides,
  }
}

function authorizedResponse(value = '139.32') {
  return {
    purchase_units: [
      {
        payments: {
          authorizations: [
            { id: 'AUTH-1', status: 'CREATED', amount: { currency_code: 'USD', value } },
          ],
        },
      },
    ],
  }
}

test.group('PayPalPaymentGateway', (group) => {
  const originalFetch = globalThis.fetch
  let calls: Call[] = []
  let responses: Record<string, unknown> = {}

  group.each.setup(() => {
    calls = []
    responses = {}
    setPayPalAccessTokenCacheForTesting({
      accessToken: 'test-token',
      expiresAt: DateTime.now().plus({ hours: 1 }),
    })
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      const method = init?.method ?? 'GET'
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const body = responses[`${method} ${path}`]
      return {
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        json: async () => body,
        text: async () => 'not found',
      } as Response
    }) as typeof fetch

    return () => {
      globalThis.fetch = originalFetch
      resetPayPalAccessTokenCache()
    }
  })

  const authorize = () =>
    new PayPalPaymentGateway().authorize({
      expectedAmount: '139.32',
      quoteUuid: QUOTE_UUID,
      metadata: {},
      providerToken: ORDER_ID,
    })
  const authorizeCalled = () =>
    calls.some((call) => call.path === `/v2/checkout/orders/${ORDER_ID}/authorize`)

  test('createOrder sends the quote total and uuid as an AUTHORIZE order', async ({ assert }) => {
    responses['POST /v2/checkout/orders'] = { id: ORDER_ID }

    const orderId = await new PayPalPaymentGateway().createOrder({
      amount: '139.32',
      quoteUuid: QUOTE_UUID,
    })

    assert.equal(orderId, ORDER_ID)
    assert.deepEqual(calls[0].body, {
      intent: 'AUTHORIZE',
      purchase_units: [
        { custom_id: QUOTE_UUID, amount: { currency_code: 'USD', value: '139.32' } },
      ],
    })
  })

  test('authorizes an approved order for exactly the quote total', async ({ assert }) => {
    responses[`GET /v2/checkout/orders/${ORDER_ID}`] = approvedOrder()
    responses[`POST /v2/checkout/orders/${ORDER_ID}/authorize`] = authorizedResponse()

    const result = await authorize()

    assert.deepEqual(result, { status: 'authorized', transactionId: 'AUTH-1' })
  })

  const refusals: [string, Record<string, any>, Record<string, any>][] = [
    ['a different amount', {}, { amount: { currency_code: 'USD', value: '1.00' } }],
    ['a different currency', {}, { amount: { currency_code: 'EUR', value: '139.32' } }],
    ['a different quote', {}, { custom_id: 'someone-elses-quote' }],
    ['an order that is not approved', { status: 'CREATED' }, {}],
    ['a capture-intent order', { intent: 'CAPTURE' }, {}],
  ]
  for (const [label, orderOverrides, unitOverrides] of refusals) {
    test(`refuses ${label} without authorizing it`, async ({ assert }) => {
      responses[`GET /v2/checkout/orders/${ORDER_ID}`] = approvedOrder(
        orderOverrides,
        unitOverrides
      )
      responses[`POST /v2/checkout/orders/${ORDER_ID}/authorize`] = authorizedResponse()

      await assert.rejects(authorize, PaymentGatewayError)
      assert.isFalse(authorizeCalled())
    })
  }

  test('refuses an order with more than one purchase unit', async ({ assert }) => {
    const order = approvedOrder()
    order.purchase_units.push({ ...order.purchase_units[0] })
    responses[`GET /v2/checkout/orders/${ORDER_ID}`] = order

    await assert.rejects(authorize, PaymentGatewayError)
    assert.isFalse(authorizeCalled())
  })

  test('refuses an authorization that comes back for a different amount', async ({ assert }) => {
    responses[`GET /v2/checkout/orders/${ORDER_ID}`] = approvedOrder()
    responses[`POST /v2/checkout/orders/${ORDER_ID}/authorize`] = authorizedResponse('1.00')

    await assert.rejects(authorize, PaymentGatewayError)
  })
})
