import string from '@adonisjs/core/helpers/string'
import encryption from '@adonisjs/core/services/encryption'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Vendor from '#models/vendor'
import { fakePaypalIdentityClient } from '#services/paypal_identity_service'
import { fakeStripeConnectClient } from '#services/stripe_connect_service'

async function signupVendor(client: any) {
  const email = `vendor-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Vendor',
    lastName: 'User',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  user.role = 'vendor'
  await user.save()
  const vendor = await Vendor.create({ uuid: string.uuid(), userId: user.id })

  return { session: response.session(), user, vendor }
}

async function startPaypal(client: any, session: any): Promise<string> {
  const response = await client.post('/v1/vendor/payout-method/paypal/connect').withSession(session)
  response.assertStatus(200)
  const url = (response.body().data as { url: string }).url
  return new URL(url).searchParams.get('state')!
}

function completePaypal(client: any, session: any, body: Record<string, string>) {
  return client.post('/v1/vendor/payout-method/paypal/callback').withSession(session).json(body)
}

test.group('Payouts | vendor payout method', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(() => {
    fakeStripeConnectClient.reset()
    fakePaypalIdentityClient.reset()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('a new vendor needs to set up payouts', async ({ client, assert }) => {
    const { session } = await signupVendor(client)

    const response = await client.get('/v1/vendor/payout-method').withSession(session)
    response.assertStatus(200)
    const data = response.body().data as Record<string, any>
    assert.equal(data.status, 'needs_setup')
    assert.isNull(data.provider)
  })

  test('Stripe onboarding creates and stores the connected account once, then reuses it', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await signupVendor(client)

    const first = await client
      .post('/v1/vendor/payout-method/stripe/onboarding')
      .withSession(session)
    first.assertStatus(200)
    await vendor.refresh()
    assert.match(vendor.stripeAccountId!, /^acct_fake_/)
    assert.equal(vendor.payoutProvider, 'stripe')
    assert.include((first.body().data as { url: string }).url, vendor.stripeAccountId!)

    // Abandoned halfway and restarted - same account, new link.
    const accountId = vendor.stripeAccountId
    const second = await client
      .post('/v1/vendor/payout-method/stripe/onboarding')
      .withSession(session)
    second.assertStatus(200)
    await vendor.refresh()
    assert.equal(vendor.stripeAccountId, accountId)
    assert.equal(fakeStripeConnectClient.accounts.size, 1)

    // Not ready until Stripe says the account can receive payouts.
    const pending = await client.get('/v1/vendor/payout-method').withSession(session)
    assert.equal((pending.body().data as Record<string, any>).status, 'needs_setup')

    fakeStripeConnectClient.setPayoutsEnabled(accountId!, true)
    const ready = await client.get('/v1/vendor/payout-method').withSession(session)
    const readyData = ready.body().data as Record<string, any>
    assert.equal(readyData.status, 'ready')
    assert.isTrue(readyData.stripeOnboardingComplete)
    assert.notProperty(readyData, 'stripeAccountId')
  })

  test('Log in with PayPal stores the verified payer id and keeps the Stripe account', async ({
    client,
    assert,
  }) => {
    const { session, vendor } = await signupVendor(client)
    await client.post('/v1/vendor/payout-method/stripe/onboarding').withSession(session)
    await vendor.refresh()
    const stripeAccountId = vendor.stripeAccountId

    const state = await startPaypal(client, session)
    const response = await completePaypal(client, session, { code: 'fake-code', state })
    response.assertStatus(200)
    const data = response.body().data as Record<string, any>
    assert.equal(data.provider, 'paypal')
    assert.equal(data.status, 'ready')
    assert.equal(data.paypalEmail, 'vendor@paypal.test')

    await vendor.refresh()
    assert.equal(vendor.paypalPayerId, 'FAKEPAYER1')
    assert.equal(vendor.stripeAccountId, stripeAccountId)
  })

  test('refuses a tampered, foreign, or expired PayPal state', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    const other = await signupVendor(client)

    const tampered = await completePaypal(client, session, {
      code: 'fake-code',
      state: 'not-a-real-state',
    })
    tampered.assertStatus(400)

    // Another vendor's state can't connect PayPal to this account.
    const othersState = await startPaypal(client, other.session)
    const foreign = await completePaypal(client, session, { code: 'fake-code', state: othersState })
    foreign.assertStatus(400)

    const expired = String(
      encryption.encrypt({ vendorId: vendor.id, nonce: 'x' }, -1, 'vendor-paypal-connect')
    )
    const expiredResponse = await completePaypal(client, session, {
      code: 'fake-code',
      state: expired,
    })
    expiredResponse.assertStatus(400)

    await vendor.refresh()
    assert.isNull(vendor.paypalPayerId)
  })

  test('refuses an unverified PayPal account', async ({ client, assert }) => {
    const { session, vendor } = await signupVendor(client)
    fakePaypalIdentityClient.nextIdentity = {
      payerId: 'UNVERIFIED1',
      email: 'new@paypal.test',
      verifiedAccount: false,
    }

    const state = await startPaypal(client, session)
    const response = await completePaypal(client, session, { code: 'fake-code', state })
    response.assertStatus(422)

    await vendor.refresh()
    assert.isNull(vendor.paypalPayerId)
  })

  test('refuses a PayPal account already connected to another vendor', async ({ client }) => {
    const first = await signupVendor(client)
    const second = await signupVendor(client)

    const firstState = await startPaypal(client, first.session)
    const firstResponse = await completePaypal(client, first.session, {
      code: 'c',
      state: firstState,
    })
    firstResponse.assertStatus(200)

    const secondState = await startPaypal(client, second.session)
    const response = await completePaypal(client, second.session, {
      code: 'c',
      state: secondState,
    })
    response.assertStatus(409)
  })

  test('non-vendors cannot use payout setup', async ({ client }) => {
    const response = await client.post('/v1/auth/new-customer').json({
      firstName: 'Just',
      lastName: 'Customer',
      email: `customer-${string.uuid()}@test.com`,
      password: 'password123',
    })

    const forbidden = await client.get('/v1/vendor/payout-method').withSession(response.session())
    forbidden.assertStatus(403)
  })
})
