import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import AuditEvent from '#models/audit_event'
import Invitation from '#models/invitation'
import User from '#models/user'
import Vendor from '#models/vendor'
import { acceptInviteLink, inviteVendor, signupAs, expectStatus } from '#tests/helpers/vendors'

/** Swaps the signature for a forged one, keeping everything else. */
function tamper(linkPath: string): string {
  const url = new URL(linkPath, 'http://localhost')
  url.searchParams.set('signature', `${url.searchParams.get('signature')}x`)
  return `${url.pathname}${url.search}`
}

test.group('Auth | invitations', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('the signed link prefills email and role and hands back a signed accept URL', async ({
    client,
    assert,
  }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'New.Vendor@Example.com')

    const response = await client.get(link)

    response.assertStatus(200)
    const data = (response.body() as any).data
    assert.equal(data.invitation.email, 'new.vendor@example.com')
    assert.equal(data.invitation.role, 'vendor')
    assert.match(data.acceptUrl, /\/v1\/auth\/invitations\/[0-9a-f-]+\/accept\?.*signature=/)
    // Nothing about who invited them.
    assert.notProperty(data.invitation, 'invitedBy')
  })

  test('accepting creates the user and an onboarding vendor, and logs them in', async ({
    client,
    assert,
  }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')

    const response = await acceptInviteLink(client, link)

    response.assertStatus(200)
    const body = (response.body() as any).data
    assert.equal(body.user.email, 'vendor@example.com')
    assert.equal(body.user.vendor.status, 'onboarding')
    assert.isFalse(body.user.vendor.onboardingComplete)

    const user = await User.findByOrFail('email', 'vendor@example.com')
    assert.equal(user.role, 'vendor')
    assert.equal(user.fullName, 'Vendor Person')
    const vendor = await Vendor.findByOrFail('userId', user.id)
    assert.equal(vendor.status, 'onboarding')

    const invitation = await Invitation.findByOrFail('email', 'vendor@example.com')
    assert.equal(invitation.status, 'accepted')
    assert.equal(invitation.acceptedUserId, user.id)

    // The session is live - the new vendor can reach their onboarding checklist.
    const onboarding = await client.get('/v1/vendor/onboarding').withSession(response.session())
    onboarding.assertStatus(200)
    assert.equal((onboarding.body() as any).data.uuid, vendor.uuid)

    const events = await AuditEvent.query().where('entityType', 'invitation')
    assert.includeMembers(
      events.map((event) => event.payload.action),
      ['invited', 'accepted']
    )
  })

  test('email and role in the accept body are ignored', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')
    const show = await client.get(link)

    const response = await client.post((show.body() as any).data.acceptUrl).json({
      password: 'password123',
      passwordConfirmation: 'password123',
      email: 'attacker@example.com',
      role: 'admin',
    })

    response.assertStatus(200)
    assert.isNull(await User.findBy('email', 'attacker@example.com'))
    const user = await User.findByOrFail('email', 'vendor@example.com')
    assert.equal(user.role, 'vendor')
  })

  test('the link is single-use', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')
    const show = await client.get(link)
    const acceptUrl = (show.body() as any).data.acceptUrl
    const body = { password: 'password123', passwordConfirmation: 'password123' }

    await expectStatus(client.post(acceptUrl).json(body), 200)

    const again = await client.post(acceptUrl).json(body)
    again.assertStatus(410)
    assert.equal((again.body() as any).reason, 'accepted')

    const reshow = await client.get(link)
    reshow.assertStatus(410)
    assert.equal((reshow.body() as any).reason, 'accepted')
    assert.lengthOf(await User.query().where('email', 'vendor@example.com'), 1)
  })

  test('a tampered signature is refused', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')
    const shown = await client.get(link)
    const acceptUrl = (shown.body() as any).data.acceptUrl

    await expectStatus(client.get(tamper(link)), 403)
    const accept = await client
      .post(tamper(acceptUrl))
      .json({ password: 'password123', passwordConfirmation: 'password123' })
    accept.assertStatus(403)
    assert.isNull(await User.findBy('email', 'vendor@example.com'))
  })

  test("the show link's signature can't be replayed on the accept URL", async ({
    client,
    assert,
  }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')
    const url = new URL(link, 'http://localhost')

    const response = await client
      .post(`${url.pathname}/accept${url.search}`)
      .json({ password: 'password123', passwordConfirmation: 'password123' })

    response.assertStatus(403)
    assert.isNull(await User.findBy('email', 'vendor@example.com'))
  })

  test('an unsigned link is refused', async ({ client }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')

    await expectStatus(client.get(new URL(link, 'http://localhost').pathname), 403)
  })

  test('an expired invitation is gone', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')
    const shown = await client.get(link)
    const acceptUrl = (shown.body() as any).data.acceptUrl

    const invitation = await Invitation.findByOrFail('email', 'vendor@example.com')
    invitation.expiresAt = DateTime.now().minus({ minutes: 1 })
    await invitation.save()

    const show = await client.get(link)
    show.assertStatus(410)
    assert.equal((show.body() as any).reason, 'expired')

    const accept = await client
      .post(acceptUrl)
      .json({ password: 'password123', passwordConfirmation: 'password123' })
    accept.assertStatus(410)
    assert.equal((accept.body() as any).reason, 'expired')
  })

  test('a revoked invitation is gone', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')
    const invitation = await Invitation.findByOrFail('email', 'vendor@example.com')

    await expectStatus(
      client.post(`/v1/admin/invitations/${invitation.uuid}/revoke`).withSession(admin.session),
      200
    )

    const show = await client.get(link)
    show.assertStatus(410)
    assert.equal((show.body() as any).reason, 'revoked')
  })

  test('accepting fails if the email was taken after the invite was sent', async ({
    client,
    assert,
  }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')
    const shown = await client.get(link)
    const acceptUrl = (shown.body() as any).data.acceptUrl

    // Someone signs up as a customer with that email in the meantime (in a
    // different case, which still counts as the same email).
    await User.create({
      uuid: string.uuid(),
      email: 'Vendor@Example.com',
      password: 'password123',
      role: 'customer',
    })

    const response = await client
      .post(acceptUrl)
      .json({ password: 'password123', passwordConfirmation: 'password123' })

    response.assertStatus(409)
    assert.lengthOf(await Vendor.all(), 0)
    const invitation = await Invitation.findByOrFail('email', 'vendor@example.com')
    assert.equal(invitation.status, 'pending')
  })

  test('the password is validated', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')
    const shown = await client.get(link)
    const acceptUrl = (shown.body() as any).data.acceptUrl

    const response = await client
      .post(acceptUrl)
      .json({ password: 'short', passwordConfirmation: 'different' })

    response.assertStatus(422)
    assert.isNull(await User.findBy('email', 'vendor@example.com'))
  })

  test('logging in with the new password works', async ({ client }) => {
    const admin = await signupAs(client, 'admin')
    const link = await inviteVendor(client, admin.session, 'vendor@example.com')
    await expectStatus(acceptInviteLink(client, link, 'correct-horse'), 200)

    const login = await client
      .post('/v1/auth/login')
      .json({ email: 'vendor@example.com', password: 'correct-horse' })

    login.assertStatus(200)
    login.assertBodyContains({ data: { user: { vendor: { status: 'onboarding' } } } })
  })
})
