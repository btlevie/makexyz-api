import { test } from '@japa/runner'
import type Stripe from 'stripe'
import { PaymentGatewayError } from '#services/payment_gateway_service'
import { StripePaymentGateway } from '#services/stripe_payment_gateway'

type Intent = Partial<Stripe.PaymentIntent>

/** A Stripe client whose PaymentIntent create/retrieve return canned intents. */
function stubClient(intents: { created?: Intent; retrieved?: Intent }) {
  const createdWith: Stripe.PaymentIntentCreateParams[] = []
  const client = {
    paymentIntents: {
      create: async (params: Stripe.PaymentIntentCreateParams) => {
        createdWith.push(params)
        return intents.created
      },
      retrieve: async () => intents.retrieved,
    },
  } as unknown as Stripe
  return { gateway: new StripePaymentGateway(client), createdWith }
}

const authorizeParams = {
  expectedAmount: '139.32',
  quoteUuid: 'quote-uuid-1',
  metadata: { checkoutSessionUuid: 'session-1' },
  providerToken: 'pm_card_visa',
}

test.group('StripePaymentGateway', () => {
  test('a manual-capture intent confirmed to requires_capture is an authorized hold', async ({
    assert,
  }) => {
    const { gateway, createdWith } = stubClient({
      created: { id: 'pi_1', status: 'requires_capture' },
    })

    const result = await gateway.authorize(authorizeParams)

    assert.deepEqual(result, { status: 'authorized', transactionId: 'pi_1' })
    assert.equal(createdWith[0].amount, 13932)
    assert.equal(createdWith[0].capture_method, 'manual')
    assert.equal(createdWith[0].metadata?.quoteUuid, 'quote-uuid-1')
  })

  test('a card needing 3D Secure returns its client secret instead of failing', async ({
    assert,
  }) => {
    const { gateway } = stubClient({
      created: { id: 'pi_1', status: 'requires_action', client_secret: 'pi_1_secret' },
    })

    const result = await gateway.authorize(authorizeParams)

    assert.deepEqual(result, {
      status: 'requires_action',
      transactionId: 'pi_1',
      clientSecret: 'pi_1_secret',
    })
  })

  test('a declined card is a gateway error', async ({ assert }) => {
    const { gateway } = stubClient({
      created: { id: 'pi_1', status: 'requires_payment_method' },
    })

    await assert.rejects(() => gateway.authorize(authorizeParams), PaymentGatewayError)
  })

  test('retrieve picks up an intent authorized after 3D Secure', async ({ assert }) => {
    const { gateway } = stubClient({
      retrieved: { id: 'pi_1', status: 'requires_capture', amount: 13932, currency: 'usd' },
    })

    const result = await gateway.retrieve('pi_1', { expectedAmount: '139.32' })

    assert.deepEqual(result, { status: 'authorized', transactionId: 'pi_1' })
  })

  test('retrieve refuses an intent for a different amount', async ({ assert }) => {
    const { gateway } = stubClient({
      retrieved: { id: 'pi_1', status: 'requires_capture', amount: 100, currency: 'usd' },
    })

    await assert.rejects(
      () => gateway.retrieve('pi_1', { expectedAmount: '139.32' }),
      PaymentGatewayError
    )
  })

  test('retrieve treats a failed challenge as a gateway error', async ({ assert }) => {
    const { gateway } = stubClient({
      retrieved: { id: 'pi_1', status: 'requires_payment_method', amount: 13932, currency: 'usd' },
    })

    await assert.rejects(
      () => gateway.retrieve('pi_1', { expectedAmount: '139.32' }),
      PaymentGatewayError
    )
  })
})
