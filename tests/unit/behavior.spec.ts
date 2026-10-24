import { test } from '@japa/runner'
import { automaticTier } from '#services/messaging_risk_service'
import { buildViews } from '#services/moderation/normalizer'
import {
  NEAR_DUPLICATE_THRESHOLD,
  resemblance,
  shingles,
} from '#services/moderation/near_duplicate'
import behaviorFanout from '#services/moderation/rules/behavior_fanout'
import behaviorRepeatAttempts from '#services/moderation/rules/behavior_repeat_attempts'
import behaviorSenderReputation from '#services/moderation/rules/behavior_sender_reputation'
import behaviorVelocity from '#services/moderation/rules/behavior_velocity'
import spamNearDuplicate from '#services/moderation/rules/spam_near_duplicate'
import urlDomainSpread from '#services/moderation/rules/url_domain_spread'
import { contextFor } from '#tests/helpers/moderation'

const PITCH =
  'We are a full service print farm with forty machines and same day shipping, visit our site for twenty percent off your first order today'

function similarity(a: string, b: string) {
  return resemblance(shingles(buildViews(a).normalized)!, shingles(buildViews(b).normalized)!)
}

test.group('Near-duplicate detection', () => {
  test('small edits stay above the threshold; separate messages fall below', ({ assert }) => {
    assert.isAbove(
      similarity(PITCH, PITCH.replace('twenty', 'twenty five')),
      NEAR_DUPLICATE_THRESHOLD
    )
    assert.isAbove(
      similarity(PITCH, PITCH.replace('forty', 'fifty').replace('same day', 'next day')),
      NEAR_DUPLICATE_THRESHOLD
    )
    assert.isBelow(
      similarity(
        'Hello, could you print twenty brackets in black PETG with ten percent infill by next Friday please?',
        'Can you print twenty brackets in white PETG with fifteen percent infill by next Monday please?'
      ),
      NEAR_DUPLICATE_THRESHOLD
    )
  })

  test('short messages are never compared', ({ assert }) => {
    assert.isNull(shingles(buildViews('Thanks, sounds good to me').normalized))
  })
})

test.group('Behavior rules', () => {
  test('velocity: weight first, then review', ({ assert }) => {
    const config = behaviorVelocity.defaultConfig
    const at = (messagesLastHour: number, messagesLastDay = messagesLastHour) =>
      behaviorVelocity.evaluate(
        contextFor('ok', { history: { messagesLastHour, messagesLastDay } }),
        config
      )
    assert.isNull(at(10))
    assert.equal(at(30)?.action, 'continue')
    assert.equal(at(60)?.action, 'review')
    assert.equal(at(5, 300)?.action, 'review')
  })

  test('fan-out applies to customers only', ({ assert }) => {
    const config = behaviorFanout.defaultConfig
    const customer = (vendorsContactedWeek: number) =>
      behaviorFanout.evaluate(
        contextFor('hi', { senderRole: 'customer', history: { vendorsContactedWeek } }),
        config
      )
    assert.isNull(customer(5))
    assert.equal(customer(12)?.action, 'continue')
    assert.equal(customer(25)?.action, 'escalate')
    assert.deepEqual(behaviorFanout.senderRoles, ['customer'])
  })

  test('recent blocks add weight, capped', ({ assert }) => {
    const config = behaviorRepeatAttempts.defaultConfig
    const weight = (blockedLastHour: number) =>
      behaviorRepeatAttempts.evaluate(contextFor('hi', { history: { blockedLastHour } }), config)
        ?.weight
    assert.isUndefined(weight(0))
    assert.equal(weight(1), 1)
    assert.equal(weight(10), 4)
  })

  test('reports and vendor blocks add weight', ({ assert }) => {
    const config = behaviorSenderReputation.defaultConfig
    const weight = (reportsReceived30d: number, vendorBlocks30d = 0) =>
      behaviorSenderReputation.evaluate(
        contextFor('hi', { history: { reportsReceived30d, vendorBlocks30d } }),
        config
      )?.weight
    assert.isUndefined(weight(1))
    assert.equal(weight(2), 2)
    assert.equal(weight(5, 1), 6)
  })

  test('near-duplicates review, except an ordinary request for quotes', ({ assert }) => {
    const config = spamNearDuplicate.defaultConfig
    const history = { nearDuplicateOtherConversations: 3 }
    assert.equal(
      spamNearDuplicate.evaluate(contextFor(PITCH, { history }), config)?.action,
      'review'
    )
    const rfq = contextFor('Could you print 20 brackets in PETG, 0.2mm layers, by Friday?', {
      senderRole: 'customer',
      conversation: { isFirstMessage: true },
      history,
    })
    assert.isNull(spamNearDuplicate.evaluate(rfq, config))
  })

  test('a domain many senders linked today escalates; allow-listed ones never do', ({ assert }) => {
    const config = urlDomainSpread.defaultConfig
    const spread = contextFor('see deals.example.shop', {
      history: { domainSenders: { 'example.shop': 5 } },
    })
    assert.equal(urlDomainSpread.evaluate(spread, config)?.action, 'escalate')
    const allowed = contextFor('see www.printables.com/model/1', {
      history: { domainSenders: { 'printables.com': 50 } },
    })
    assert.isNull(urlDomainSpread.evaluate(allowed, config))
  })
})

test.group('Automatic trust tiers', () => {
  const counters = (deliveredMessages: number, confirmedViolations = 0, reportsReceived = 0) => ({
    deliveredMessages,
    confirmedViolations,
    latestConfirmedAt: null,
    reportsReceived,
    vendorBlocks: 0,
  })

  test('new, standard, trusted', ({ assert }) => {
    assert.equal(automaticTier(2, counters(100)), 'new')
    assert.equal(automaticTier(30, counters(3)), 'new')
    assert.equal(automaticTier(30, counters(10)), 'standard')
    assert.equal(automaticTier(90, counters(60)), 'trusted')
    assert.equal(automaticTier(90, counters(60, 0, 1)), 'standard')
    assert.equal(automaticTier(null, counters(60)), 'new')
  })
})
