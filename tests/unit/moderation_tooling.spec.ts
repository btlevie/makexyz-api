import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Message from '#models/message'
import MessageUrl from '#models/message_url'
import ModerationCase from '#models/moderation_case'
import { highlights } from '#services/case_detail_service'
import { anonymize } from '#services/corpus_export_service'
import { labelOf, sinceFrom } from '#services/moderation_replay_service'

function message(status: Message['status']) {
  return new Message().merge({ status })
}

function resolvedCase(fields: Partial<ModerationCase>) {
  return new ModerationCase().merge({ status: 'resolved', ...fields })
}

test.group('Moderator tooling helpers', () => {
  test('evidence spans are located in the body, case-insensitively', ({ assert }) => {
    const spans = highlights('Email me at Jo@Gmail.com or jo@gmail.com', [
      { ruleId: 'contact.email', evidence: [{ view: 'normalized', match: 'jo@gmail.com' }] },
    ])
    assert.deepEqual(
      spans.map((span) => [span.start, span.end]),
      [
        [12, 24],
        [28, 40],
      ]
    )
  })

  test('labels come from human decisions', ({ assert }) => {
    assert.equal(
      labelOf(message('removed'), [resolvedCase({ resolution: 'removed' })]),
      'violation'
    )
    assert.equal(
      labelOf(message('delivered'), [
        resolvedCase({ resolution: 'no_action', abuseCategory: 'spam' }),
      ]),
      'violation'
    )
    assert.equal(labelOf(message('delivered'), [resolvedCase({ resolution: 'approved' })]), 'clean')
    assert.equal(labelOf(message('delivered'), []), 'clean')
    // An automatic block nobody reviewed says nothing either way.
    assert.equal(labelOf(message('blocked'), []), 'unlabelled')
    assert.equal(
      labelOf(message('pending_review'), [new ModerationCase().merge({ status: 'open' })]),
      'unlabelled'
    )
  })

  test('replay windows', ({ assert }) => {
    const now = DateTime.fromISO('2026-10-24T12:00:00Z')
    assert.equal(sinceFrom('90d', now).toISODate(), '2026-07-26')
    assert.equal(sinceFrom('24h', now).toISO(), now.minus({ hours: 24 }).toISO())
    assert.equal(sinceFrom('2w', now).toISODate(), '2026-10-10')
    assert.throws(() => sinceFrom('soon', now))
  })

  test('corpus text keeps only link domains and drops contact details', ({ assert }) => {
    const url = new MessageUrl().merge({
      match: 'https://shop.example.net/deal?ref=abc',
      registrableDomain: 'example.net',
    })
    const text = anonymize('Deal at https://shop.example.net/deal?ref=abc or jo@gmail.com', [url])
    assert.equal(text, 'Deal at https://example.net/... or [email]')
  })
})
