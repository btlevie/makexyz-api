import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Invitation from '#models/invitation'
import User from '#models/user'
import Vendor from '#models/vendor'
import { acceptInviteLink, inviteLinkPath, signupAs, expectStatus } from '#tests/helpers/vendors'

async function createUser(email: string, role: 'admin' | 'customer' | 'vendor') {
  return User.create({ uuid: string.uuid(), email, password: 'password123', role })
}

test.group('Admin | invitations', (group) => {
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

  test('non-admins cannot invite', async ({ client }) => {
    const customer = await signupAs(client, 'customer')

    const response = await client
      .post('/v1/admin/invitations')
      .withSession(customer.session)
      .json({ email: 'vendor@example.com', role: 'vendor' })

    response.assertStatus(403)
  })

  test('creates an invitation and returns the invite page URL carrying the signed link', async ({
    client,
    assert,
  }) => {
    const admin = await signupAs(client, 'admin')

    const response = await client
      .post('/v1/admin/invitations')
      .withSession(admin.session)
      .json({ email: '  Vendor@Example.com ', role: 'vendor' })

    response.assertStatus(200)
    const { invitation, inviteUrl } = (response.body() as any).data
    assert.equal(invitation.email, 'vendor@example.com')
    assert.equal(invitation.role, 'vendor')
    assert.equal(invitation.status, 'pending')
    assert.equal(invitation.invitedBy.uuid, admin.user.uuid)
    assert.isTrue(inviteUrl.startsWith('http://localhost:3000/invite?link='))
    // No personal data in the link - just the invite uuid and its signature.
    assert.notInclude(inviteLinkPath(inviteUrl), 'example.com')
  })

  test('refuses an email that belongs to another role, naming it', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    await createUser('Customer@Example.com', 'customer')

    const response = await client
      .post('/v1/admin/invitations')
      .withSession(admin.session)
      .json({ email: 'customer@example.com', role: 'vendor' })

    response.assertStatus(409)
    assert.equal((response.body() as any).existingRole, 'customer')
    assert.lengthOf(await Invitation.all(), 0)
    // Never converted.
    const user = await User.findByOrFail('email', 'Customer@Example.com')
    assert.equal(user.role, 'customer')
  })

  test('refuses an email that is already a vendor, pointing at the vendor', async ({
    client,
    assert,
  }) => {
    const admin = await signupAs(client, 'admin')
    const user = await createUser('vendor@example.com', 'vendor')
    const vendor = await Vendor.create({ uuid: string.uuid(), userId: user.id })

    const response = await client
      .post('/v1/admin/invitations')
      .withSession(admin.session)
      .json({ email: 'vendor@example.com', role: 'vendor' })

    response.assertStatus(409)
    assert.equal((response.body() as any).existingRole, 'vendor')
    assert.equal((response.body() as any).vendorUuid, vendor.uuid)
  })

  test('re-inviting a pending email returns the same invitation with a fresh link', async ({
    client,
    assert,
  }) => {
    const admin = await signupAs(client, 'admin')
    const invite = (email: string) =>
      client
        .post('/v1/admin/invitations')
        .withSession(admin.session)
        .json({ email, role: 'vendor' })

    const first = await invite('vendor@example.com')
    const second = await invite('VENDOR@example.com')

    second.assertStatus(200)
    assert.equal(
      (second.body() as any).data.invitation.uuid,
      (first.body() as any).data.invitation.uuid
    )
    assert.lengthOf(await Invitation.all(), 1)
    // Both links point at the same pending row, so both still work.
    await expectStatus(client.get(inviteLinkPath((first.body() as any).data.inviteUrl)), 200)
    await expectStatus(client.get(inviteLinkPath((second.body() as any).data.inviteUrl)), 200)
  })

  test('resend pushes the expiry out and revives an expired invitation', async ({
    client,
    assert,
  }) => {
    const admin = await signupAs(client, 'admin')
    const created = await client
      .post('/v1/admin/invitations')
      .withSession(admin.session)
      .json({ email: 'vendor@example.com', role: 'vendor' })
    const invitation = await Invitation.findByOrFail(
      'uuid',
      (created.body() as any).data.invitation.uuid
    )
    invitation.expiresAt = DateTime.now().minus({ days: 1 })
    await invitation.save()

    const response = await client
      .post(`/v1/admin/invitations/${invitation.uuid}/resend`)
      .withSession(admin.session)

    response.assertStatus(200)
    assert.equal((response.body() as any).data.invitation.status, 'pending')
    await invitation.refresh()
    assert.isTrue(invitation.expiresAt > DateTime.now().plus({ days: 6 }))
    await expectStatus(client.get(inviteLinkPath((response.body() as any).data.inviteUrl)), 200)
  })

  test('accepted and revoked invitations cannot be resent or revoked', async ({ client }) => {
    const admin = await signupAs(client, 'admin')
    const accepted = await client
      .post('/v1/admin/invitations')
      .withSession(admin.session)
      .json({ email: 'accepted@example.com', role: 'vendor' })
    await expectStatus(
      acceptInviteLink(client, inviteLinkPath((accepted.body() as any).data.inviteUrl)),
      200
    )
    const acceptedUuid = (accepted.body() as any).data.invitation.uuid

    await expectStatus(
      client.post(`/v1/admin/invitations/${acceptedUuid}/resend`).withSession(admin.session),
      409
    )
    await expectStatus(
      client.post(`/v1/admin/invitations/${acceptedUuid}/revoke`).withSession(admin.session),
      409
    )

    const revoked = await client
      .post('/v1/admin/invitations')
      .withSession(admin.session)
      .json({ email: 'revoked@example.com', role: 'vendor' })
    const revokedUuid = (revoked.body() as any).data.invitation.uuid
    await expectStatus(
      client.post(`/v1/admin/invitations/${revokedUuid}/revoke`).withSession(admin.session),
      200
    )
    await expectStatus(
      client.post(`/v1/admin/invitations/${revokedUuid}/resend`).withSession(admin.session),
      409
    )
  })

  test('lists invitations, filterable by derived status', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
      await client
        .post('/v1/admin/invitations')
        .withSession(admin.session)
        .json({ email, role: 'vendor' })
    }
    const b = await Invitation.findByOrFail('email', 'b@example.com')
    b.revokedAt = DateTime.now()
    await b.save()
    const c = await Invitation.findByOrFail('email', 'c@example.com')
    c.expiresAt = DateTime.now().minus({ hours: 1 })
    await c.save()

    const all = await client.get('/v1/admin/invitations').withSession(admin.session)
    all.assertStatus(200)
    assert.lengthOf((all.body() as any).data, 3)

    const statuses: Record<string, string> = {
      pending: 'a@example.com',
      revoked: 'b@example.com',
      expired: 'c@example.com',
    }
    for (const [status, email] of Object.entries(statuses)) {
      const filtered = await client
        .get('/v1/admin/invitations')
        .qs({ status })
        .withSession(admin.session)
      filtered.assertStatus(200)
      assert.deepEqual(
        (filtered.body() as any).data.map((invitation: { email: string }) => invitation.email),
        [email]
      )
    }

    await expectStatus(
      client.get('/v1/admin/invitations').qs({ status: 'bogus' }).withSession(admin.session),
      422
    )
  })
})
