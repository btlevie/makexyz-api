import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import mail from '@adonisjs/mail/services/main'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import NewMessageNotification from '#mails/new_message_notification'
import ConversationParticipant from '#models/conversation_participant'
import Message from '#models/message'
import MessageUrl from '#models/message_url'
import MessagingRiskProfile from '#models/messaging_risk_profile'
import ModerationAction from '#models/moderation_action'
import ModerationCase from '#models/moderation_case'
import UrlDomain from '#models/url_domain'
import UrlScan from '#models/url_scan'
import {
  analyzeHeldMessage,
  rescanRecentUrls,
  sweepHeldMessages,
} from '#services/message_analysis_service'
import { sendPendingNotification } from '#services/message_notification_service'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import { clearDomainListCache } from '#services/moderation/url/domain_registry'
import { normalizeUrl } from '#services/moderation/url/normalize'
import {
  fakeRdap,
  fakeUrlFetcher,
  fakeWebRisk,
  resetUrlAnalysisFakes,
} from '#services/url_analysis_service'
import { signupAs } from '#tests/helpers/vendors'
import {
  activeVendor,
  dataOf,
  mailText,
  messagePayload,
  startInquiry,
  verifiedCustomer,
} from '#tests/helpers/messaging'

test.group('Messaging: link safety', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    clearRuleConfigCache()
    clearDomainListCache()
    resetUrlAnalysisFakes()
    return async () => {
      clearRuleConfigCache()
      clearDomainListCache()
      resetUrlAnalysisFakes()
      mail.restore()
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

  /** Runs the queued AnalyzeMessage pass for a message, as the worker would. */
  async function analyze(messageUuid: string, final = false) {
    const message = await Message.findByOrFail('uuid', messageUuid)
    await analyzeHeldMessage(message.id, { final })
    await message.refresh()
    return message
  }

  test('an unknown link is held, checked, then delivered behind the interstitial', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const sent = await send(
      client,
      customer.session,
      uuid,
      'Samples at https://my-shop.example.net/s'
    )
    assert.equal(sent.status, 'held')
    const queued = await db.from('queue_jobs').where('dedup_id', 'like', '%analyze-%')
    assert.lengthOf(queued, 1)

    const vendorBefore = await client
      .get(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
    assert.lengthOf(dataOf(vendorBefore), 1)

    const message = await analyze(sent.uuid)
    assert.equal(message.status, 'delivered')
    assert.include(fakeWebRisk.searched, 'https://my-shop.example.net/s')
    assert.include(fakeUrlFetcher.resolved, 'https://my-shop.example.net/s')

    const vendorView = await client
      .get(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
    const delivered = dataOf(vendorView).find((m: any) => m.uuid === sent.uuid)
    assert.equal(delivered.links[0].match, 'https://my-shop.example.net/s')
    assert.equal(delivered.links[0].href, `http://localhost:3000/links/${delivered.links[0].token}`)

    const link = await client.get(`/v1/links/${delivered.links[0].token}`)
    link.assertStatus(200)
    assert.deepEqual(dataOf(link), {
      verdict: 'safe',
      url: 'https://my-shop.example.net/s',
      domain: 'my-shop.example.net',
    })
  })

  test('a cached verdict is reused - the next message with the link is delivered at once', async ({
    client,
    assert,
  }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const first = await send(client, customer.session, uuid, 'See https://my-shop.example.net/s')
    await analyze(first.uuid)
    const second = await send(
      client,
      customer.session,
      uuid,
      'Again: https://MY-SHOP.example.net/s?utm_source=x'
    )
    assert.equal(second.status, 'delivered')
    assert.lengthOf(fakeWebRisk.searched, 1)
  })

  test('a link Web Risk flags is blocked with the generic reason', async ({ client, assert }) => {
    const { customer, uuid } = await inquiryBetween(client)
    fakeWebRisk.threats.set('https://login-verify.example.net/', ['SOCIAL_ENGINEERING'])
    const sent = await send(
      client,
      customer.session,
      uuid,
      'Verify at https://login-verify.example.net'
    )
    const message = await analyze(sent.uuid)
    assert.equal(message.status, 'blocked')
    assert.equal(message.blockReasonCode, 'url.unsafe')
    assert.equal(message.userFacingReason, "This message couldn't be delivered.")
    const scan = await UrlScan.findByOrFail(
      'urlHash',
      normalizeUrl('https://login-verify.example.net')!.hash
    )
    assert.equal(scan.verdict, 'malicious')
    assert.deepEqual(scan.threatTypes, ['SOCIAL_ENGINEERING'])
  })

  test('a shortener is judged by where it ends up', async ({ client, assert }) => {
    const { customer, uuid } = await inquiryBetween(client)
    fakeUrlFetcher.redirects.set('http://bit.ly/3abc', 'https://evil-pay.example.net/x')
    fakeWebRisk.threats.set('https://evil-pay.example.net/x', ['MALWARE'])
    const sent = await send(client, customer.session, uuid, 'Pay here bit.ly/3abc')
    const viaShortener = await analyze(sent.uuid)
    assert.equal(viaShortener.status, 'blocked')

    fakeUrlFetcher.redirects.set('http://tinyurl.com/inside', 'http://10.0.0.5/admin')
    fakeUrlFetcher.blocked.add('http://10.0.0.5/admin')
    const internal = await send(client, customer.session, uuid, 'tinyurl.com/inside')
    const intoNetwork = await analyze(internal.uuid)
    assert.equal(intoNetwork.status, 'blocked')
  })

  test('without a reputation the link waits for a person', async ({ client, assert }) => {
    const { customer, uuid } = await inquiryBetween(client)
    fakeWebRisk.available = false
    const sent = await send(client, customer.session, uuid, 'See https://my-shop.example.net/s')
    const message = await analyze(sent.uuid)
    assert.equal(message.status, 'pending_review')
    assert.equal(message.blockReasonCode, 'url.reputation_unknown')
    await ModerationCase.query()
      .where('messageId', message.id)
      .where('source', 'auto_hold')
      .firstOrFail()
  })

  test('a days-old domain: review from a customer, blocked from a vendor', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    // An established customer - a new account would be blocked too.
    await MessagingRiskProfile.create({ customerId: customer.customer.id, trustTier: 'standard' })
    fakeRdap.dates.set('fresh-deals.shop', DateTime.now().minus({ days: 2 }))

    const fromCustomer = await send(client, customer.session, uuid, 'see fresh-deals.shop')
    const reviewed = await analyze(fromCustomer.uuid)
    assert.equal(reviewed.status, 'pending_review')
    const fromVendor = await send(client, vendor.session, uuid, 'see fresh-deals.shop/offer')
    const blocked = await analyze(fromVendor.uuid)
    assert.equal(blocked.status, 'blocked')
    assert.equal(blocked.blockReasonCode, 'url.very_young_domain')
    const domain = await UrlDomain.findByOrFail('domain', 'fresh-deals.shop')
    assert.isNotNull(domain.registeredAt)
  })

  test('look-alike and private-address links are blocked at send, with no analysis', async ({
    client,
    assert,
  }) => {
    const { customer, uuid } = await inquiryBetween(client)
    for (const body of [
      'Pay at https://paypa1.com/invoice',
      'Admin at http://169.254.169.254/latest',
    ]) {
      const sent = await send(client, customer.session, uuid, body)
      assert.equal(sent.status, 'blocked')
    }
    assert.lengthOf(fakeWebRisk.searched, 0)
  })

  test('allow-listed links are delivered at once', async ({ client, assert }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const sent = await send(
      client,
      customer.session,
      uuid,
      'Model: https://www.printables.com/model/123'
    )
    assert.equal(sent.status, 'delivered')
  })

  test('a link that turns malicious later is removed everywhere it was sent', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const sent = await send(
      client,
      customer.session,
      uuid,
      'Drawings: https://drawings.example.net/7'
    )
    const delivered = await analyze(sent.uuid)
    assert.equal(delivered.status, 'delivered')
    const link = await MessageUrl.findByOrFail('messageId', delivered.id)

    // Weaponized after the fact; the cached "safe" expires and the rescan sees it.
    fakeWebRisk.threats.set('https://drawings.example.net/7', ['SOCIAL_ENGINEERING'])
    await UrlScan.query().update({ expires_at: DateTime.now().minus({ minutes: 1 }).toSQL() })
    const result = await rescanRecentUrls()
    assert.deepEqual(result, { rescanned: 1, removed: 1 })

    const message = await Message.findByOrFail('uuid', sent.uuid)
    assert.equal(message.status, 'removed')
    const moderationCase = await ModerationCase.findByOrFail('messageId', message.id)
    assert.equal(moderationCase.source, 'url_rescan')
    assert.isTrue(moderationCase.missedByAutomation)

    const vendorView = await client
      .get(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
    const tombstone = dataOf(vendorView).find((m: any) => m.uuid === sent.uuid)
    assert.deepInclude(tombstone, { removed: true, body: null, links: [] })
    const click = await client.get(`/v1/links/${link.token}`)
    click.assertStatus(404)
  })

  test('the interstitial re-checks at click time', async ({ client, assert }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    const sent = await send(client, customer.session, uuid, 'See https://drawings.example.net/7')
    await analyze(sent.uuid)
    const link = await MessageUrl.firstOrFail()

    const block = await client
      .put('/v1/admin/moderation/domains/drawings.example.net')
      .withSession(admin.session)
      .json({ listStatus: 'block', note: 'phishing kit' })
    block.assertStatus(200)
    const click = await client.get(`/v1/links/${link.token}`)
    assert.deepEqual(dataOf(click), {
      verdict: 'blocked',
      url: null,
      domain: 'drawings.example.net',
    })
  })

  test('a message held too long gets a final pass and goes to a person', async ({
    client,
    assert,
  }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const sent = await send(client, customer.session, uuid, 'See https://my-shop.example.net/s')
    await Message.query()
      .where('uuid', sent.uuid)
      .update({ created_at: DateTime.now().minus({ minutes: 30 }).toSQL() })
    await db.from('queue_jobs').delete()

    assert.equal(await sweepHeldMessages(), 1)
    const [job] = await db.from('queue_jobs').where('dedup_id', 'like', '%analyze-%')
    assert.include(String(job.data), '"final":true')
  })

  test('emails carry the interstitial, never the raw link', async ({ client, assert }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    await MessagingRiskProfile.create({ customerId: customer.customer.id, trustTier: 'standard' })
    const sent = await send(
      client,
      customer.session,
      uuid,
      'Model: https://www.Printables.com/model/123'
    )
    assert.equal(sent.status, 'delivered')
    const { mails } = mail.fake()

    const participant = await ConversationParticipant.query()
      .where('vendorId', vendor.vendor.id)
      .firstOrFail()
    await sendPendingNotification(participant.id)
    const link = await MessageUrl.firstOrFail()
    mails.assertSent(NewMessageNotification, (message) => {
      const text = mailText(message)
      return (
        text.includes(`http://localhost:3000/links/${link.token}`) &&
        !text.includes('printables.com')
      )
    })
  })

  test('admins manage the domain lists; every change is audited', async ({ client, assert }) => {
    const { customer, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')

    const allow = await client
      .put('/v1/admin/moderation/domains/Supplier.Example.NET')
      .withSession(admin.session)
      .json({ listStatus: 'allow', note: 'resin supplier datasheets' })
    allow.assertStatus(200)
    assert.deepInclude(dataOf(allow), {
      domain: 'supplier.example.net',
      listStatus: 'allow',
      overridden: true,
    })

    const sent = await send(
      client,
      customer.session,
      uuid,
      'Datasheet: https://supplier.example.net/tds.pdf'
    )
    assert.equal(sent.status, 'delivered')

    const list = await client
      .get('/v1/admin/moderation/domains?list=allow')
      .withSession(admin.session)
    assert.isTrue(dataOf(list).some((row: any) => row.domain === 'supplier.example.net'))
    assert.isTrue(
      dataOf(list).some((row: any) => row.domain === 'printables.com' && !row.overridden)
    )
    // Sightings are counted per registrable domain.
    const seen = await client
      .get('/v1/admin/moderation/domains?q=example.net')
      .withSession(admin.session)
    assert.equal(dataOf(seen).find((row: any) => row.domain === 'example.net').seenCount, 1)

    const cleared = await client
      .put('/v1/admin/moderation/domains/supplier.example.net')
      .withSession(admin.session)
      .json({ listStatus: null })
    assert.equal(dataOf(cleared).listStatus, 'none')

    const actions = await ModerationAction.query()
      .where('action', 'domain_list_updated')
      .orderBy('id')
    assert.deepEqual(
      actions.map((action) => [action.targetId, action.metadata]),
      [
        ['supplier.example.net', { before: null, after: 'allow' }],
        ['supplier.example.net', { before: 'allow', after: null }],
      ]
    )

    const bad = await client
      .put('/v1/admin/moderation/domains/not_a_domain')
      .withSession(admin.session)
      .json({ listStatus: 'block' })
    bad.assertStatus(422)

    const forbidden = await client.get('/v1/admin/moderation/domains').withSession(customer.session)
    forbidden.assertStatus(403)
  })
})
