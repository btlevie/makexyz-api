import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import Message from '#models/message'
import ModerationCase from '#models/moderation_case'
import { discoverAbusePatterns, fakePatternSummarizer } from '#services/abuse_pattern_service'
import { exportCorpus } from '#services/corpus_export_service'
import { replay } from '#services/moderation_replay_service'
import { ruleStats } from '#services/rule_stats_service'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import { clearDomainListCache } from '#services/moderation/url/domain_registry'
import { resetUrlAnalysisFakes } from '#services/url_analysis_service'
import { signupAs } from '#tests/helpers/vendors'
import {
  activeVendor,
  analyzeWithoutReputation,
  dataOf,
  messagePayload,
  startInquiry,
  verifiedCustomer,
} from '#tests/helpers/messaging'

test.group('Messaging: the moderation learning loop', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    clearRuleConfigCache()
    clearDomainListCache()
    resetUrlAnalysisFakes()
    fakePatternSummarizer.reset()
    return async () => {
      clearRuleConfigCache()
      clearDomainListCache()
      resetUrlAnalysisFakes()
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
    return Message.findByOrFail('uuid', dataOf(response).uuid)
  }

  /** A moderator's decision on a message: 'blocked' (violation) or 'approved' (fine). */
  async function judge(
    message: Message,
    resolution: 'blocked' | 'removed' | 'approved',
    fields: Partial<ModerationCase> = {}
  ) {
    return ModerationCase.create({
      uuid: string.uuid(),
      messageId: message.id,
      customerId: message.senderCustomerId,
      vendorId: message.senderVendorId,
      source: 'report',
      priority: 40,
      status: 'resolved',
      resolution,
      resolvedAt: DateTime.now(),
      missedByAutomation: false,
      ...fields,
    })
  }

  test('replaying stored inputs reproduces the original decisions, every time', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    await send(client, vendor.session, uuid, 'Sure, 20 units in PETG by Friday works.')
    await send(client, vendor.session, uuid, 'Or email me at jo@gmail.com')
    await send(
      client,
      customer.session,
      uuid,
      'Here is the model: https://www.printables.com/model/1'
    )

    const since = DateTime.now().minus({ days: 1 })
    const first = await replay({ since })
    const second = await replay({ since })
    assert.equal(first.evaluated, 4)
    assert.equal(first.changedDecisions, 0)
    assert.deepEqual(first, second)
  })

  test('replaying one rule measures recall and false positives against labels', async ({
    client,
    assert,
  }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const fine = await send(
      client,
      vendor.session,
      uuid,
      'The quote is ready, check the order page.'
    )
    const miss = await send(client, vendor.session, uuid, 'whats ur insta? lets chat there instead')
    const caught = await send(client, vendor.session, uuid, 'add me on telegram, quicker')
    await judge(miss, 'removed', {
      abuseCategory: 'off_platform_contact',
      missedByAutomation: true,
    })
    await judge(caught, 'removed', { abuseCategory: 'off_platform_contact' })
    await judge(fine, 'approved')
    void customer

    const report = await replay({
      ruleId: 'contact.platform_handle',
      since: DateTime.now().minus({ days: 1 }),
    })
    assert.equal(report.violations, 2)
    assert.isAtLeast(report.violationsCaught, 1)
    assert.equal(report.cleanHit, 0)
    assert.isAbove(report.clean, 0)
    assert.equal(report.falsePositiveRate, 0)
  })

  test('per-rule precision flags an enforcing rule moderators keep overturning', async ({
    client,
    assert,
  }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    // url.reputation_unknown enforces; five of its hits get approved.
    for (let i = 0; i < 5; i++) {
      const message = await send(
        client,
        vendor.session,
        uuid,
        `Datasheet: https://supplier-${i}.example.net/tds`
      )
      await analyzeWithoutReputation(message.uuid)
      const held = await ModerationCase.findByOrFail('messageId', message.id)
      await held
        .merge({ status: 'resolved', resolution: 'approved', resolvedAt: DateTime.now() })
        .save()
    }
    const stats = await ruleStats(30)
    const rule = stats.find((entry) => entry.ruleId === 'url.reputation_unknown')!
    assert.equal(rule.overturned, 5)
    assert.equal(rule.precision, 0)
    assert.isTrue(rule.suggestShadow)
  })

  test('discovery clusters missed violations by domain and phrase', async ({ client, assert }) => {
    const admin = await signupAs(client, 'admin')
    const violations: Message[] = []
    for (let i = 0; i < 3; i++) {
      const { vendor, uuid } = await inquiryBetween(client)
      violations.push(
        await send(
          client,
          vendor.session,
          uuid,
          `Ask about our loyalty rewards club at https://www.rewards-club.example/join?ref=${i}`
        )
      )
    }
    for (const message of violations) {
      await judge(message, 'removed', { abuseCategory: 'advertising', missedByAutomation: true })
    }

    const report = await discoverAbusePatterns()
    assert.equal(report.violations, 3)
    assert.equal(report.missedByAutomation, 3)
    const clusters = report.clusters ?? []
    assert.isTrue(
      clusters.some(
        (entry) =>
          entry.kind === 'domain' && entry.key === 'rewards-club.example' && entry.size === 3
      )
    )
    assert.isTrue(
      clusters.some((entry) => entry.kind === 'phrase' && entry.key === 'loyalty rewards')
    )
    assert.isTrue(clusters.some((entry) => entry.kind === 'near_duplicate' && entry.size === 3))
    assert.isAbove(fakePatternSummarizer.calls.length, 0)
    assert.isAbove((report.summaries ?? []).length, 0)

    const list = await client.get('/v1/admin/moderation/pattern-reports').withSession(admin.session)
    assert.equal(dataOf(list).reports[0].uuid, report.uuid)
    const detail = await client
      .get(`/v1/admin/moderation/pattern-reports/${report.uuid}`)
      .withSession(admin.session)
    assert.lengthOf(dataOf(detail).clusters, clusters.length)
  })

  test('the corpus export is anonymized', async ({ client, assert }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    const message = await send(
      client,
      vendor.session,
      uuid,
      'Our catalogue: https://www.printfarm.example/catalog?id=7 - call 415-555-2671'
    )
    await judge(message, 'removed', { abuseCategory: 'advertising', patternNote: 'catalogue link' })

    const entries = await exportCorpus({
      since: DateTime.now().minus({ days: 1 }),
      labelledOnly: true,
    })
    const entry = entries.find((row) => row.label === 'violation')!
    assert.deepInclude(entry, {
      category: 'advertising',
      note: 'catalogue link',
      role: 'vendor',
      kind: 'inquiry',
    })
    assert.include(entry.text, 'https://printfarm.example/...')
    assert.notInclude(entry.text, 'catalog?id=7')
    assert.notInclude(entry.text, '2671')
  })

  test('every moderation admin endpoint is admin-only', async ({ client }) => {
    const customer = await verifiedCustomer(client)
    const vendor = await activeVendor(client)
    const caseUuid = string.uuid()
    const endpoints: [string, string][] = [
      ['get', '/v1/admin/moderation/cases'],
      ['get', `/v1/admin/moderation/cases/${caseUuid}`],
      ['post', `/v1/admin/moderation/cases/${caseUuid}/claim`],
      ['post', `/v1/admin/moderation/cases/${caseUuid}/release`],
      ['post', `/v1/admin/moderation/cases/${caseUuid}/approve`],
      ['post', `/v1/admin/moderation/cases/${caseUuid}/block`],
      ['post', `/v1/admin/moderation/cases/${caseUuid}/restrict`],
      ['patch', `/v1/admin/moderation/cases/${caseUuid}/label`],
      ['post', `/v1/admin/moderation/cases/${caseUuid}/warn`],
      ['post', `/v1/admin/moderation/cases/${caseUuid}/close-conversation`],
      ['get', '/v1/admin/moderation/rules'],
      ['get', '/v1/admin/moderation/rules/stats'],
      ['get', '/v1/admin/moderation/pattern-reports'],
      ['get', `/v1/admin/moderation/pattern-reports/${caseUuid}`],
      ['get', '/v1/admin/moderation/terms'],
      ['get', '/v1/admin/moderation/domains'],
      ['get', '/v1/admin/moderation/profiles'],
      ['get', '/v1/admin/moderation/llm-stats'],
    ]
    for (const [method, url] of endpoints) {
      const anonymous = await (client as any)[method](url)
      anonymous.assertStatus(401)
      for (const session of [customer.session, vendor.session]) {
        const response = await (client as any)[method](url).withSession(session).json({
          message: 'a warning long enough',
          tier: 'restricted',
        })
        response.assertStatus(403)
      }
    }
  })
})
