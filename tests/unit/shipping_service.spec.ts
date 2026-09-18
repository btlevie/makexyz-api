import { test } from '@japa/runner'
import {
  InvalidShippingSelectionError,
  resolveShippingFee,
  resolveShippingOptions,
} from '#services/shipping_service'

test.group('Shipping options', () => {
  test('US offers free, UPS 2-day, and UPS overnight', ({ assert }) => {
    const options = resolveShippingOptions('US')

    assert.sameDeepMembers(options, [
      { method: 'free', feeAmount: 0 },
      { method: 'ups_2day', feeAmount: 29 },
      { method: 'ups_overnight', feeAmount: 75 },
    ])
  })

  test('non-US offers only free and expedited', ({ assert }) => {
    const options = resolveShippingOptions('CA')

    assert.sameDeepMembers(options, [
      { method: 'free', feeAmount: 0 },
      { method: 'international_expedited', feeAmount: 49 },
    ])
  })

  test('resolves the fee for a valid selection', ({ assert }) => {
    assert.equal(resolveShippingFee('US', 'ups_overnight'), 75)
    assert.equal(resolveShippingFee('GB', 'international_expedited'), 49)
  })

  test('rejects a domestic-only method for an international destination', ({ assert }) => {
    assert.throws(
      () => resolveShippingFee('GB', 'ups_2day' as any),
      InvalidShippingSelectionError
    )
  })
})
