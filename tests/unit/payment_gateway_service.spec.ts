import { test } from '@japa/runner'
import { FakePaymentGateway, PaymentGatewayError } from '#services/payment_gateway_service'

test.group('FakePaymentGateway', (group) => {
  let gateway: FakePaymentGateway

  group.each.setup(() => {
    gateway = new FakePaymentGateway()
  })

  test('authorize returns a unique transaction id per call', async ({ assert }) => {
    const first = await gateway.authorize({ amount: 10, metadata: {} })
    const second = await gateway.authorize({ amount: 10, metadata: {} })

    assert.notEqual(first.transactionId, second.transactionId)
  })

  test('capture returns a provider fee and net amount that sum to the original amount', async ({
    assert,
  }) => {
    const { transactionId } = await gateway.authorize({ amount: 100, metadata: {} })

    const result = await gateway.capture(transactionId)

    assert.approximately(result.providerFee + result.netAmount, 100, 0.01)
    assert.isAbove(result.providerFee, 0)
  })

  test('cancel releases an authorized transaction', async ({ assert }) => {
    const { transactionId } = await gateway.authorize({ amount: 50, metadata: {} })

    await gateway.cancel(transactionId)

    await assert.rejects(() => gateway.capture(transactionId), PaymentGatewayError)
  })

  test('cannot capture the same transaction twice', async ({ assert }) => {
    const { transactionId } = await gateway.authorize({ amount: 50, metadata: {} })
    await gateway.capture(transactionId)

    await assert.rejects(() => gateway.capture(transactionId), PaymentGatewayError)
  })

  test('cannot cancel an already-captured transaction', async ({ assert }) => {
    const { transactionId } = await gateway.authorize({ amount: 50, metadata: {} })
    await gateway.capture(transactionId)

    await assert.rejects(() => gateway.cancel(transactionId), PaymentGatewayError)
  })

  test('capturing an unknown transaction fails', async ({ assert }) => {
    await assert.rejects(() => gateway.capture('does-not-exist'), PaymentGatewayError)
  })

  test('reset clears all state', async ({ assert }) => {
    const { transactionId } = await gateway.authorize({ amount: 50, metadata: {} })

    gateway.reset()

    await assert.rejects(() => gateway.capture(transactionId), PaymentGatewayError)
  })
})
