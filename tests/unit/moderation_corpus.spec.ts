/**
 * Regression corpus for the moderation rules (tests/fixtures/moderation/
 * corpus.json): labelled messages, legitimate ones included, run through
 * every rule in its launch mode.
 *
 * Each entry asserts the decision with launch defaults (shadow rules record
 * hits but don't decide), which rules must fire (shadow included - that's
 * how a shadow rule earns promotion), and which must not. When a new abuse
 * pattern is found, add its examples here with the rule that catches them.
 */
import { readFileSync } from 'node:fs'
import { test } from '@japa/runner'
import { combine } from '#services/moderation/combiner'
import { RULES } from '#services/moderation/rules/index'
import type { ConversationKind, Decision, SenderRole } from '#services/moderation/types'
import { contextFor } from '#tests/helpers/moderation'

interface CorpusEntry {
  note: string
  role: SenderRole
  kind?: ConversationKind
  first?: boolean
  orderStatus?: string
  sameTextOtherConversations?: number
  text: string
  decision: Decision
  fires?: string[]
  notFires?: string[]
}

const corpus: CorpusEntry[] = JSON.parse(
  readFileSync(new URL('../fixtures/moderation/corpus.json', import.meta.url), 'utf8')
)

/** The pipeline's rule loop, with every rule in its launch (default) mode and no database. */
function evaluateWithDefaults(entry: CorpusEntry) {
  const ctx = contextFor(entry.text, {
    senderRole: entry.role,
    conversation: {
      kind: entry.kind ?? 'inquiry',
      isFirstMessage: entry.first ?? false,
      orderStatus: entry.orderStatus ?? null,
    },
    history: { sameTextOtherConversations: entry.sameTextOtherConversations ?? 0 },
  })
  const fired = RULES.filter((rule) =>
    rule.senderRoles ? rule.senderRoles.includes(entry.role) : entry.role !== 'staff'
  )
    .filter((rule) => rule.defaultMode !== 'off')
    .flatMap((rule) => {
      const result = rule.evaluate(ctx, rule.defaultConfig)
      return result ? [{ ruleId: rule.id, result, shadow: rule.defaultMode === 'shadow' }] : []
    })
  return { fired: fired.map((hit) => hit.ruleId), decision: combine(fired, 'standard').decision }
}

test.group('Moderation corpus', () => {
  test('{note}')
    .with(corpus)
    .run(({ assert }, entry) => {
      const { fired, decision } = evaluateWithDefaults(entry)
      assert.equal(decision, entry.decision, `decision (fired: ${fired.join(', ') || 'none'})`)
      for (const ruleId of entry.fires ?? []) {
        assert.include(fired, ruleId, `expected ${ruleId} to fire`)
      }
      for (const ruleId of entry.notFires ?? []) {
        assert.notInclude(fired, ruleId, `expected ${ruleId} not to fire`)
      }
    })
})
