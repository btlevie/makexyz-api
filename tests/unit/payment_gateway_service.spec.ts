import { test } from '@japa/runner'
import { FakePaymentGateway, PaymentGatewayError, toCents } from '#services/payment_gateway_service'

test.group('FakePaymentGateway', (group) => {
  let gateway: FakePaymentGateway

  group.each.setup(() => {
    gateway = new FakePaymentGateway()
  })

  test('authorize returns a unique transaction id per call', async ({ assert }) => {
    const first = await gateway.authorize({
      expectedAmount: '10.00',
      quoteUuid: 'test-quote',
      metadata: {},
    })
    const second = await gateway.authorize({
      expectedAmount: '10.00',
      quoteUuid: 'test-quote',
      metadata: {},
    })

    assert.notEqual(first.transactionId, second.transactionId)
  })

  test('capture returns a provider fee and net amount that sum to the original amount', async ({
    assert,
  }) => {
    const { transactionId } = await gateway.authorize({
      expectedAmount: '100.00',
      quoteUuid: 'test-quote',
      metadata: {},
    })

    const result = await gateway.capture(transactionId)

    assert.approximately(result.providerFee + result.netAmount, 100, 0.01)
    assert.isAbove(result.providerFee, 0)
  })

  test('cancel releases an authorized transaction', async ({ assert }) => {
    const { transactionId } = await gateway.authorize({
      expectedAmount: '50.00',
      quoteUuid: 'test-quote',
      metadata: {},
    })

    await gateway.cancel(transactionId)

    await assert.rejects(() => gateway.capture(transactionId), PaymentGatewayError)
  })

  test('cannot capture the same transaction twice', async ({ assert }) => {
    const { transactionId } = await gateway.authorize({
      expectedAmount: '50.00',
      quoteUuid: 'test-quote',
      metadata: {},
    })
    await gateway.capture(transactionId)

    await assert.rejects(() => gateway.capture(transactionId), PaymentGatewayError)
  })

  test('cannot cancel an already-captured transaction', async ({ assert }) => {
    const { transactionId } = await gateway.authorize({
      expectedAmount: '50.00',
      quoteUuid: 'test-quote',
      metadata: {},
    })
    await gateway.capture(transactionId)

    await assert.rejects(() => gateway.cancel(transactionId), PaymentGatewayError)
  })

  test('capturing an unknown transaction fails', async ({ assert }) => {
    await assert.rejects(() => gateway.capture('does-not-exist'), PaymentGatewayError)
  })

  test('reset clears all state', async ({ assert }) => {
    const { transactionId } = await gateway.authorize({
      expectedAmount: '50.00',
      quoteUuid: 'test-quote',
      metadata: {},
    })

    gateway.reset()

    await assert.rejects(() => gateway.capture(transactionId), PaymentGatewayError)
  })
})

test.group('toCents', () => {
  test('converts decimal strings and plain numbers to integer cents', ({ assert }) => {
    assert.equal(toCents('139.32'), 13932)
    assert.equal(toCents('108'), 10800)
    assert.equal(toCents('108.5'), 10850)
    assert.equal(toCents('108.0000'), 10800)
    assert.equal(toCents(108), 10800)
    assert.equal(toCents('0.07'), 7)
  })

  test('rejects fractional cents and malformed amounts', ({ assert }) => {
    assert.throws(() => toCents('1.005'), PaymentGatewayError)
    assert.throws(() => toCents('-5.00'), PaymentGatewayError)
    assert.throws(() => toCents('12abc'), PaymentGatewayError)
    assert.throws(() => toCents(''), PaymentGatewayError)
  })
})
