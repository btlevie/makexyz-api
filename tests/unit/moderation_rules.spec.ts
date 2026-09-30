import { test } from '@japa/runner'
import { buildViews } from '#services/moderation/normalizer'
import { extractSignals } from '#services/moderation/extractors'
import { combine } from '#services/moderation/combiner'
import contactEmail from '#services/moderation/rules/contact_email'
import contactPhone from '#services/moderation/rules/contact_phone'
import urlNonAllowlisted from '#services/moderation/rules/url_non_allowlisted'
import type { ModerationRule, RuleContext } from '#services/moderation/types'

function contextFor(text: string): RuleContext {
  const views = buildViews(text)
  return {
    views,
    signals: extractSignals(views),
    senderRole: 'vendor',
    channel: 'web',
    conversationKind: 'inquiry',
  }
}

function run(rule: ModerationRule, text: string) {
  return rule.evaluate(contextFor(text), rule.defaultConfig)
}

test.group('Moderation rule: contact.email', () => {
  test('blocks a plain address: {$self}')
    .with([
      'Email me at jo.smith@gmail.com',
      'JO.SMITH@GMAIL.COM works too',
      'reach me: jo+quotes@shop.co.uk',
    ])
    .run(({ assert }, text) => {
      assert.equal(run(contactEmail, text)?.action, 'block')
    })

  test('blocks a bracket-obfuscated address: {$self}')
    .with([
      'jo[at]gmail[dot]com',
      'jo (at) gmail (dot) com',
      'jo{at}gmail{.}com',
      'jo@gmail[.]com',
      'jo​@gmail.com',
    ])
    .run(({ assert }, text) => {
      assert.equal(run(contactEmail, text)?.action, 'block')
    })

  test('sends a spaced " at " address to review rather than blocking', ({ assert }) => {
    const result = run(contactEmail, 'jo at gmail dot com')
    assert.equal(result?.action, 'review')
    assert.equal(result?.reasonCode, 'contact.email_possible')
  })

  test('ignores text that only looks like an address: {$self}')
    .with([
      'The part@2x.png render is attached',
      'Tolerance is ±0.1mm at the bore',
      'Printed at 0.2 layer height, 20% infill',
      'I paid through MakeXYZ yesterday',
    ])
    .run(({ assert }, text) => {
      assert.isNull(run(contactEmail, text))
    })

  test('records the matched address as evidence', ({ assert }) => {
    const result = run(contactEmail, 'write to jo@gmail.com')
    assert.deepEqual(result?.evidence, [{ view: 'normalized', match: 'jo@gmail.com' }])
    assert.isString(result?.userMessage)
  })
})

test.group('Moderation rule: contact.phone', () => {
  test('blocks a valid phone number: {$self}')
    .with([
      'Call me at (415) 555-2671',
      'my cell is 415.555.2671',
      'text +1 415 555 2671',
      'whatsapp +44 20 7946 0958',
    ])
    .run(({ assert }, text) => {
      assert.equal(run(contactPhone, text)?.action, 'block')
    })

  test('ignores numbers that are not phone numbers: {$self}')
    .with([
      'Order ORD-7K2Q9XW4LM is ready',
      'Part is 120x80x40 mm, qty 250',
      'Tracking: 9400111899223856923456',
      'FedEx tracking 772345678901',
      'UPS 1Z999AA10123456784',
      'Can you do 1000 units by 2026-11-15?',
    ])
    .run(({ assert }, text) => {
      assert.isNull(run(contactPhone, text))
    })
})

test.group('Moderation rule: url.any_non_allowlisted_holds', () => {
  test('holds a link to an unknown domain: {$self}')
    .with([
      'See https://my-print-shop.example.net/deals',
      'check myshop.xyz for more',
      'hxxps://evil[.]com/login',
      'www.some-random-store.com',
    ])
    .run(({ assert }, text) => {
      const result = run(urlNonAllowlisted, text)
      assert.equal(result?.action, 'review')
      assert.equal(result?.reasonCode, 'url.unverified')
    })

  test('lets allowlisted links through: {$self}')
    .with([
      'Model is at https://www.printables.com/model/12345-bracket',
      'Track it: https://www.ups.com/track?tracknum=1Z999AA10123456784',
      'thingiverse.com/thing:4242',
    ])
    .run(({ assert }, text) => {
      assert.isNull(run(urlNonAllowlisted, text))
    })

  test('ignores text without links: {$self}')
    .with([
      'Can you print this in PETG by Friday?',
      'Files are bracket.zip and housing.stl, 0.2mm layers, i.e. fine detail',
      'Version v1.5 of the part.step, etc.',
      'Tolerance ±0.05 mm on the M3 holes',
    ])
    .run(({ assert }, text) => {
      assert.isNull(run(urlNonAllowlisted, text))
    })

  test('a file-extension TLD still counts with a path or www: {$self}')
    .with(['grab it at files.zip/download', 'www.cheap-parts.zip'])
    .run(({ assert }, text) => {
      assert.equal(run(urlNonAllowlisted, text)?.action, 'review')
    })
})

test.group('Moderation combiner', () => {
  test('block beats review, and the blocking rule decides', ({ assert }) => {
    const combined = combine([
      { ruleId: 'a', result: { action: 'review', reasonCode: 'a', evidence: [] }, shadow: false },
      { ruleId: 'b', result: { action: 'block', reasonCode: 'b', evidence: [] }, shadow: false },
    ])
    assert.equal(combined.decision, 'block')
    assert.equal(combined.decidedBy?.ruleId, 'b')
  })

  test('shadow hits never affect the decision', ({ assert }) => {
    const combined = combine([
      { ruleId: 'a', result: { action: 'block', reasonCode: 'a', evidence: [] }, shadow: true },
    ])
    assert.equal(combined.decision, 'allow')
    assert.isNull(combined.decidedBy)
  })

  test('weak signals only route by score, never block', ({ assert }) => {
    const weak = (ruleId: string) => ({
      ruleId,
      result: { action: 'continue' as const, reasonCode: ruleId, weight: 6, evidence: [] },
      shadow: false,
    })
    const combined = combine([weak('a'), weak('b'), weak('c')])
    assert.equal(combined.riskScore, 18)
    assert.equal(combined.decision, 'review')
  })
})
