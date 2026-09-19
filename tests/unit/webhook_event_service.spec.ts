import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { hasProcessed, markProcessed } from '#services/webhook_event_service'

test.group('Webhook event service - idempotency', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(() => {
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('an unprocessed event id reports unprocessed, then processed once marked', async ({
    assert,
  }) => {
    assert.isFalse(await hasProcessed('stripe', 'evt_123'))

    await db.transaction(async (trx) => {
      await markProcessed('stripe', 'evt_123', 'charge.refunded', trx)
    })

    assert.isTrue(await hasProcessed('stripe', 'evt_123'))
  })

  test('the same event id under a different provider is tracked independently', async ({
    assert,
  }) => {
    await db.transaction(async (trx) => {
      await markProcessed('stripe', 'evt_shared', 'charge.refunded', trx)
    })

    assert.isTrue(await hasProcessed('stripe', 'evt_shared'))
    assert.isFalse(await hasProcessed('paypal', 'evt_shared'))
  })
})
