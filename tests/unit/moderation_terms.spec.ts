import { test } from '@japa/runner'
import ModerationTerm from '#models/moderation_term'
import prohibitedDrugs from '#services/moderation/rules/prohibited_drugs'
import prohibitedFirearm from '#services/moderation/rules/prohibited_firearm'
import { mergeTerms, normalizeTerm } from '#services/moderation/term_registry'
import type { ProhibitedConfig } from '#services/moderation/rules/prohibited_shared'
import { contextFor } from '#tests/helpers/moderation'

/** An unsaved moderation_terms row - mergeTerms only reads its fields. */
function row(fields: Partial<ModerationTerm>): ModerationTerm {
  return new ModerationTerm().merge({
    uuid: `uuid-${fields.term}`,
    status: 'active',
    action: 'review',
    ...fields,
  } as Partial<ModerationTerm>)
}

/** Runs a prohibited rule with the given admin rows applied, as the registry would. */
function runWith(
  rule: typeof prohibitedDrugs,
  category: 'drugs' | 'firearm',
  rows: ModerationTerm[],
  text: string
) {
  const terms = mergeTerms(rows)
  const config: ProhibitedConfig = {
    ...rule.defaultConfig,
    terms: terms.categories[category],
    contextAllow: terms.contextAllow,
  }
  return rule.evaluate(contextFor(text, { senderRole: 'customer' }), config)
}

test.group('Moderation terms', () => {
  test('stored terms are normalized like message text', ({ assert }) => {
    assert.equal(normalizeTerm('  Blue   DREAM '), 'blue dream')
    // Cyrillic а folded to Latin.
    assert.equal(normalizeTerm('glаss pipe'), 'glass pipe')
  })

  test('an admin review term holds the message', ({ assert }) => {
    const result = runWith(
      prohibitedDrugs,
      'drugs',
      [row({ category: 'drugs', term: 'plug' })],
      'who is your plug?'
    )
    assert.equal(result?.action, 'escalate')
    assert.equal(result?.reasonCode, 'prohibited.drugs_review_term')
    assert.deepInclude(result!.evidence[0], {
      match: 'plug',
      termSource: 'admin',
      termUuid: 'uuid-plug',
    })
  })

  test('an admin block term blocks with the policy reason and opens a case', ({ assert }) => {
    const result = runWith(
      prohibitedDrugs,
      'drugs',
      [row({ category: 'drugs', term: 'blue dream cart', action: 'block' })],
      'need a case for my blue dream cart'
    )
    assert.equal(result?.action, 'block')
    assert.equal(result?.caseSource, 'prohibited_item')
  })

  test('an admin weight term only adds weight', ({ assert }) => {
    const result = runWith(
      prohibitedDrugs,
      'drugs',
      [row({ category: 'drugs', term: 'snow', action: 'weight' })],
      'snow globe base'
    )
    assert.equal(result?.action, 'continue')
    assert.equal(result?.weight, 1)
  })

  test('a shadow term is recorded with no effect', ({ assert }) => {
    const result = runWith(
      prohibitedDrugs,
      'drugs',
      [row({ category: 'drugs', term: 'zaza', status: 'shadow' })],
      'got any zaza?'
    )
    assert.equal(result?.action, 'continue')
    assert.equal(result?.weight, 0)
    assert.equal(result?.reasonCode, 'prohibited.drugs_shadow_term')
    assert.equal(result?.evidence[0].termStatus, 'shadow')
  })

  test('disabling a built-in term stops it firing', ({ assert }) => {
    const before = runWith(prohibitedDrugs, 'drugs', [], 'a custom bong')
    assert.equal(before?.action, 'block')

    const after = runWith(
      prohibitedDrugs,
      'drugs',
      [row({ category: 'drugs', term: 'bong', status: 'disabled', action: 'block' })],
      'a custom bong'
    )
    assert.isNull(after)
  })

  test('overriding a built-in can soften it from block to review', ({ assert }) => {
    const result = runWith(
      prohibitedDrugs,
      'drugs',
      [row({ category: 'drugs', term: 'bong', action: 'review' })],
      'a custom bong'
    )
    assert.equal(result?.action, 'escalate')
  })

  test('an admin context word lowers a block to escalate', ({ assert }) => {
    const text = 'glock switch replica for a stage play'
    assert.equal(runWith(prohibitedFirearm, 'firearm', [], text)?.action, 'block')
    const result = runWith(
      prohibitedFirearm,
      'firearm',
      [row({ category: 'context_allow', term: 'stage play', action: null })],
      text
    )
    assert.equal(result?.action, 'escalate')
  })

  test('leetspeak and spacing variants of an admin term match', ({ assert }) => {
    const rows = [row({ category: 'drugs', term: 'zaza', action: 'block' })]
    assert.equal(runWith(prohibitedDrugs, 'drugs', rows, 'any z4z4 left?')?.action, 'block')
    assert.equal(runWith(prohibitedDrugs, 'drugs', rows, 'any z a z a left?')?.action, 'block')
  })

  test('with no admin rows the built-in lists apply unchanged', ({ assert }) => {
    const merged = mergeTerms([])
    assert.isAbove(merged.categories.firearm.block.length, 20)
    assert.isTrue(merged.all.every((entry) => entry.source === 'builtin'))
  })
})
