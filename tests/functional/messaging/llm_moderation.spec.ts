import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import db from '@adonisjs/lucid/services/db'
import Message from '#models/message'
import ModerationCase from '#models/moderation_case'
import ModerationEvaluation from '#models/moderation_evaluation'
import { analyzeHeldMessage } from '#services/message_analysis_service'
import {
  fakeClassifier,
  overrideLlmSettings,
  shadowClassify,
} from '#services/llm_moderation_service'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import { clearDomainListCache } from '#services/moderation/url/domain_registry'
import { resetUrlAnalysisFakes } from '#services/url_analysis_service'
import { signupAs } from '#tests/helpers/vendors'
import {
  activeVendor,
  dataOf,
  messagePayload,
  startInquiry,
  verifiedCustomer,
} from '#tests/helpers/messaging'

/**
 * A vendor sending a customer a file-sharing link: held until the link is
 * checked, then escalated by url.user_content_from_vendor - the band the LLM
 * decides when enforcing.
 */
const ESCALATING = 'The revised drawing is at https://drive.google.com/file/d/abc123/view'

test.group('Messaging: LLM-assisted moderation', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    clearRuleConfigCache()
    clearDomainListCache()
    resetUrlAnalysisFakes()
    fakeClassifier.reset()
    overrideLlmSettings({ mode: 'enforce' })
    return async () => {
      overrideLlmSettings(null)
      fakeClassifier.reset()
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
    const vendor = await activeVendor(client, 'Acme Print Works')
    const started = await startInquiry(client, customer.session, vendor.vendor)
    started.assertStatus(201)
    return { customer, vendor, uuid: dataOf(started).conversation.uuid as string }
  }

  async function sendAndAnalyze(client: any, session: any, uuid: string, body = ESCALATING) {
    const response = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(session)
      .json(messagePayload(body))
    response.assertStatus(201)
    const message = await Message.findByOrFail('uuid', dataOf(response).uuid)
    expectHeld(message)
    await analyzeHeldMessage(message.id)
    await message.refresh()
    return message
  }

  function expectHeld(message: Message) {
    if (message.status !== 'held') throw new Error(`expected held, got ${message.status}`)
  }

  test('a confident allow delivers the escalated message', async ({ client, assert }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    fakeClassifier.verdict('allow', 0.92)
    const message = await sendAndAnalyze(client, vendor.session, uuid)
    assert.equal(message.status, 'delivered')

    const evaluation = await ModerationEvaluation.query()
      .where('messageId', message.id)
      .whereNotNull('llm')
      .firstOrFail()
    const llm = evaluation.llm as Record<string, any>
    assert.equal(llm.outcome, 'allow')
    assert.equal(llm.mode, 'enforce')
    assert.equal(llm.promptVersion, 'moderation-v1')
    assert.isAbove(llm.usage.costUsd, 0)
  })

  test('the context is pseudonymized and shows withheld history', async ({ client, assert }) => {
    const { customer, vendor, uuid } = await inquiryBetween(client)
    const blocked = await client
      .post(`/v1/conversations/${uuid}/messages`)
      .withSession(vendor.session)
      .json(messagePayload('Email me at sales@acmeprint.com instead'))
    assert.equal(dataOf(blocked).status, 'blocked')

    await sendAndAnalyze(client, vendor.session, uuid)
    const [context] = fakeClassifier.calls
    const sent = JSON.stringify(context)
    assert.notInclude(sent, 'Acme Print Works')
    assert.notInclude(sent, customer.user.email)
    assert.notInclude(sent, 'acmeprint.com')
    assert.equal(context.history[0].role, 'CUSTOMER')
    assert.equal(context.history[1].text, '[message withheld: reason=contact.email]')
    assert.deepInclude(context.sender, { role: 'vendor', blockedMessages30d: 1 })
    assert.include(
      context.rulesFired.map((rule) => rule.ruleId),
      'url.user_content_from_vendor'
    )
  })

  test('a confident block of a clear category blocks, without saying why', async ({
    client,
    assert,
  }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    fakeClassifier.verdict('block', 0.97, [{ category: 'scam_phishing', confidence: 0.97 }])
    const message = await sendAndAnalyze(client, vendor.session, uuid)
    assert.equal(message.status, 'blocked')
    assert.equal(message.blockReasonCode, 'llm.block')
    assert.equal(message.userFacingReason, "This message couldn't be delivered.")
  })

  test('harassment, low confidence and failures all go to a person', async ({ client, assert }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    fakeClassifier.verdict('block', 0.99, [{ category: 'harassment', confidence: 0.99 }])
    fakeClassifier.verdict('allow', 0.6)
    fakeClassifier.respond({
      ok: false,
      failure: 'refusal',
      detail: 'general_harms',
      usage: null,
      model: 'fake-classifier',
      latencyMs: 3,
    })
    fakeClassifier.respond({
      ok: false,
      failure: 'malformed',
      detail: 'not json',
      usage: null,
      model: 'fake-classifier',
      latencyMs: 3,
    })

    const reasons = []
    for (let i = 0; i < 4; i++) {
      const message = await sendAndAnalyze(client, vendor.session, uuid, `${ESCALATING}?v=${i}`)
      assert.equal(message.status, 'pending_review')
      reasons.push(message.blockReasonCode)
    }
    assert.deepEqual(reasons, ['llm.review', 'llm.review', 'llm.refusal', 'llm.malformed'])
    assert.lengthOf(await ModerationCase.query().where('source', 'auto_hold'), 4)
  })

  test('the per-sender budget caps calls; a repeated text reuses its verdict', async ({
    client,
    assert,
  }) => {
    const { vendor, uuid } = await inquiryBetween(client)
    // Same text again (to the same conversation) reuses the first verdict.
    await sendAndAnalyze(client, vendor.session, uuid)
    const again = await sendAndAnalyze(client, vendor.session, uuid)
    assert.equal(again.status, 'delivered')
    assert.lengthOf(fakeClassifier.calls, 1)

    overrideLlmSettings({ mode: 'enforce', hourlyBudget: 1 })
    const capped = await sendAndAnalyze(client, vendor.session, uuid, `${ESCALATING}?new`)
    assert.equal(capped.status, 'pending_review')
    assert.equal(capped.blockReasonCode, 'llm.budget_exceeded')
    assert.lengthOf(fakeClassifier.calls, 1)
  })

  test('shadow mode: a person decides, the verdict is recorded alongside', async ({
    client,
    assert,
  }) => {
    overrideLlmSettings({ mode: 'shadow' })
    const { vendor, uuid } = await inquiryBetween(client)
    const message = await sendAndAnalyze(client, vendor.session, uuid)
    assert.equal(message.status, 'pending_review')
    assert.lengthOf(fakeClassifier.calls, 0)
    const queued = await db.from('queue_jobs').where('data', 'like', `%"messageId":${message.id}%`)
    assert.isAbove(queued.length, 0)

    fakeClassifier.verdict('allow', 0.9)
    await shadowClassify(message.id)
    await message.refresh()
    assert.equal(message.status, 'pending_review')
    const shadow = await ModerationEvaluation.query()
      .where('messageId', message.id)
      .whereNotNull('llm')
      .firstOrFail()
    assert.equal((shadow.llm as any).mode, 'shadow')
    assert.equal(shadow.decision, 'allow')
  })

  test('off: escalations go straight to a person', async ({ client, assert }) => {
    overrideLlmSettings({ mode: 'off' })
    const { vendor, uuid } = await inquiryBetween(client)
    const message = await sendAndAnalyze(client, vendor.session, uuid)
    assert.equal(message.status, 'pending_review')
    assert.lengthOf(fakeClassifier.calls, 0)
  })

  test('admins see calls, cost and agreement with moderators', async ({ client, assert }) => {
    overrideLlmSettings({ mode: 'shadow' })
    const { vendor, uuid } = await inquiryBetween(client)
    const admin = await signupAs(client, 'admin')
    const message = await sendAndAnalyze(client, vendor.session, uuid)
    fakeClassifier.verdict('allow', 0.9)
    await shadowClassify(message.id)

    const moderationCase = await ModerationCase.query().where('messageId', message.id).firstOrFail()
    await client
      .post(`/v1/admin/moderation/cases/${moderationCase.uuid}/approve`)
      .withSession(admin.session)
      .json({})

    const stats = await client
      .get('/v1/admin/moderation/llm-stats?days=7')
      .withSession(admin.session)
    stats.assertStatus(200)
    assert.deepInclude(dataOf(stats), {
      mode: 'shadow',
      calls: 1,
      moderatorAgreement: { compared: 1, agreed: 1 },
    })
    assert.isAbove(dataOf(stats).costUsd, 0)

    const forbidden = await client.get('/v1/admin/moderation/llm-stats').withSession(vendor.session)
    forbidden.assertStatus(403)
  })
})
