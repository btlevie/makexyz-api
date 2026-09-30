import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import mail from '@adonisjs/mail/services/main'
import EmailVerificationNotification from '#mails/email_verification_notification'
import User from '#models/user'
import { signedVerificationPath } from '#services/email_verification_service'
import { dataOf } from '#tests/helpers/messaging'
import { acceptInviteLink, inviteVendor, signupAs } from '#tests/helpers/vendors'

test.group('Email verification', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    mail.fake()
    return async () => {
      mail.restore()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('customer signup sends a verification link and starts unverified', async ({
    client,
    assert,
  }) => {
    const { mails } = mail.fake()
    const email = `new-${string.uuid()}@test.com`

    const response = await client.post('/v1/auth/new-customer').json({
      firstName: 'Jane',
      lastName: 'Doe',
      email,
      password: 'password123',
    })
    response.assertStatus(200)

    mails.assertSent(EmailVerificationNotification, (sent) => sent.message.hasTo(email))
    const user = await User.findByOrFail('email', email)
    assert.isNull(user.emailVerifiedAt)

    const profile = await client.get('/v1/account/profile').withSession(response.session())
    assert.isFalse(dataOf(profile).emailVerified)
  })

  test('the signed link verifies the signed-in account', async ({ client, assert }) => {
    const { session, user } = await signupAs(client, 'customer')

    const response = await client.post(signedVerificationPath(user)).withSession(session)

    response.assertStatus(200)
    assert.isTrue(dataOf(response).emailVerified)
    await user.refresh()
    assert.isNotNull(user.emailVerifiedAt)
  })

  test("a link can't verify a different account", async ({ client, assert }) => {
    const { user: victim } = await signupAs(client, 'customer')
    const { session: attacker } = await signupAs(client, 'customer')

    const response = await client.post(signedVerificationPath(victim)).withSession(attacker)

    response.assertStatus(403)
    await victim.refresh()
    assert.isNull(victim.emailVerifiedAt)
  })

  test('a tampered link is rejected', async ({ client }) => {
    const { session, user } = await signupAs(client, 'customer')
    const path = signedVerificationPath(user).replace('signature=', 'signature=x')

    const response = await client.post(path).withSession(session)
    response.assertStatus(403)
  })

  test('a link stops working if the account email changes', async ({ client }) => {
    const { session, user } = await signupAs(client, 'customer')
    const path = signedVerificationPath(user)
    user.email = `changed-${string.uuid()}@test.com`
    await user.save()

    const response = await client.post(path).withSession(session)
    response.assertStatus(403)
  })

  test('resend sends a new link, and is a no-op once verified', async ({ client }) => {
    const { session, user } = await signupAs(client, 'customer')
    const { mails } = mail.fake()

    const first = await client.post('/v1/account/email-verification').withSession(session)
    first.assertStatus(202)
    mails.assertSentCount(EmailVerificationNotification, 1)

    await client.post(signedVerificationPath(user)).withSession(session)
    const second = await client.post('/v1/account/email-verification').withSession(session)
    second.assertStatus(202)
    mails.assertSentCount(EmailVerificationNotification, 1)
  })

  test('accepting an emailed invitation counts as verifying the email', async ({
    client,
    assert,
  }) => {
    const { session: adminSession } = await signupAs(client, 'admin')
    const email = `vendor-${string.uuid()}@test.com`
    const link = await inviteVendor(client, adminSession, email)

    const response = await acceptInviteLink(client, link)
    response.assertStatus(200)

    const user = await User.findByOrFail('email', email)
    assert.isNotNull(user.emailVerifiedAt)
  })
})
