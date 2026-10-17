import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import ModerationAction from '#models/moderation_action'
import ModerationCase from '#models/moderation_case'
import ModerationTerm from '#models/moderation_term'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import { clearTermCache } from '#services/moderation/term_registry'
import { signupAs } from '#tests/helpers/vendors'
import {
  activeVendor,
  dataOf,
  messagePayload,
  startInquiry,
  verifiedCustomer,
} from '#tests/helpers/messaging'

test.group('Messaging: admin-managed prohibited-item terms', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    clearRuleConfigCache()
    clearTermCache()
    return async () => {
      clearRuleConfigCache()
      clearTermCache()
      await limiter.clear(['memory'])
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  async function inquiryBetween(client: any) {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const started = await startInquiry(client, customer.session, vendor.vendor)
    started.assertStatus(201)
    return { customer, vendor, uuid: dataOf(started).conversation.uuid as string }
  }

  async function send(client: any, session: any, uuid: string, body: string) {
    const response = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(session)
      .json(messagePayload(body))
    response.assertStatus(201)
    return dataOf(response)
  }

  test('new slang holds messages for review, and upgrading it blocks them', async ({
    client,
    assert,
  }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')

    const before = await send(
      client,
      customer.session,
      uuid,
      'Can you make a case for my zaza jar?'
    )
    assert.equal(before.status, 'delivered')

    const added = await client
      .post('/v1/admin/moderation/terms')
      .withSession(admin.session)
      .json({ category: 'drugs', term: 'Zaza', note: 'slang for high-grade cannabis' })
    added.assertStatus(201)
    assert.deepInclude(dataOf(added), {
      term: 'zaza',
      action: 'review',
      status: 'active',
      source: 'admin',
    })

    const held = await send(client, customer.session, uuid, 'Another zaza jar please')
    assert.equal(held.status, 'pending_review')

    const upgrade = await client
      .patch(`/v1/admin/moderation/terms/${dataOf(added).uuid}`)
      .withSession(admin.session)
      .json({ action: 'block' })
    upgrade.assertStatus(200)

    const blocked = await send(client, customer.session, uuid, 'One more zaza jar')
    assert.equal(blocked.status, 'blocked')
    assert.include(blocked.reason, 'Prohibited items policy')
    await ModerationCase.query().where('source', 'prohibited_item').firstOrFail()

    const actions = await ModerationAction.query().orderBy('id', 'asc')
    assert.deepEqual(
      actions.map((action) => [action.action, action.targetId]),
      [
        ['term_added', 'drugs:zaza'],
        ['term_updated', 'drugs:zaza'],
      ]
    )
  })

  test('disabling a built-in term lets that word through', async ({ client, assert }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    const blocked = await send(client, customer.session, uuid, 'A bong-shaped vase')
    assert.equal(blocked.status, 'blocked')

    const disable = await client
      .post('/v1/admin/moderation/terms')
      .withSession(admin.session)
      .json({ category: 'drugs', term: 'bong', status: 'disabled', note: 'too many vases' })
    disable.assertStatus(201)
    assert.deepInclude(dataOf(disable), { source: 'builtin', overridden: true, status: 'disabled' })

    const allowed = await send(client, customer.session, uuid, 'A bong-shaped vase, take two')
    assert.equal(allowed.status, 'delivered')
    const action = await ModerationAction.findByOrFail('action', 'term_disabled')
    assert.equal(action.targetId, 'drugs:bong')
  })

  test('the listing merges built-in and admin terms with 30-day hit counts', async ({
    client,
    assert,
  }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    await send(client, customer.session, uuid, 'Can you print a glock switch?')
    await client
      .post('/v1/admin/moderation/terms')
      .withSession(admin.session)
      .json({ category: 'firearm', term: 'giggle switch' })

    const list = await client
      .get('/v1/admin/moderation/terms?category=firearm')
      .withSession(admin.session)
    list.assertStatus(200)
    const terms = dataOf(list)
    assert.deepInclude(
      terms.find((term: any) => term.term === 'glock switch'),
      {
        source: 'builtin',
        action: 'block',
        hits30d: 1,
      }
    )
    assert.deepInclude(
      terms.find((term: any) => term.term === 'giggle switch'),
      {
        source: 'admin',
        hits30d: 0,
      }
    )

    const search = await client
      .get('/v1/admin/moderation/terms?q=giggle')
      .withSession(admin.session)
    assert.lengthOf(dataOf(search), 1)
  })

  test('preview shows what a term would catch without changing anything', async ({
    client,
    assert,
  }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    await send(client, customer.session, uuid, 'Looking for some snow for the weekend')
    await send(client, customer.session, uuid, 'Snow globe base, 20 of them')

    const preview = await client
      .post('/v1/admin/moderation/terms/preview')
      .withSession(admin.session)
      .json({ category: 'drugs', term: 'snow' })

    preview.assertStatus(200)
    const result = dataOf(preview)
    assert.equal(result.matches, 2)
    assert.lengthOf(result.samples, 2)
    assert.include(result.samples[0].snippet, 'snow')
    assert.equal(
      await ModerationTerm.query()
        .count('* as n')
        .first()
        .then((r) => Number(r!.$extras.n)),
      0
    )
  })

  test('preview warns about everyday manufacturing words', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const preview = await client
      .post('/v1/admin/moderation/terms/preview')
      .withSession(admin.session)
      .json({ category: 'firearm', term: 'barrel print' })
    assert.isNotEmpty(dataOf(preview).warnings)
  })

  test('adding the same term twice conflicts; bad input is rejected', async ({ client }) => {
    const admin = await signupAs(client, 'admin')
    const first = await client
      .post('/v1/admin/moderation/terms')
      .withSession(admin.session)
      .json({ category: 'drugs', term: 'zaza' })
    first.assertStatus(201)

    const again = await client
      .post('/v1/admin/moderation/terms')
      .withSession(admin.session)
      .json({ category: 'drugs', term: ' ZAZA ' })
    again.assertStatus(409)

    const noLetters = await client
      .post('/v1/admin/moderation/terms')
      .withSession(admin.session)
      .json({ category: 'drugs', term: '4:20' })
    noLetters.assertStatus(422)

    const contextWithAction = await client
      .post('/v1/admin/moderation/terms')
      .withSession(admin.session)
      .json({ category: 'context_allow', term: 'stage play', action: 'block' })
    contextWithAction.assertStatus(422)

    const unknownCategory = await client
      .post('/v1/admin/moderation/terms')
      .withSession(admin.session)
      .json({ category: 'snacks', term: 'chips' })
    unknownCategory.assertStatus(422)
  })

  test('only admins can manage terms', async ({ client }) => {
    const customer = await verifiedCustomer(client)
    for (const request of [
      client.get('/v1/admin/moderation/terms'),
      client.post('/v1/admin/moderation/terms').json({ category: 'drugs', term: 'zaza' }),
      client.post('/v1/admin/moderation/terms/preview').json({ category: 'drugs', term: 'zaza' }),
    ]) {
      const response = await request.withSession(customer.session)
      response.assertStatus(403)
    }
  })
})
