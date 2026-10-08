import { prohibitedRule } from '#services/moderation/rules/prohibited_shared'

/** Counterfeit/IP knock-offs and devices for fraud or getting into others' property. */
export default prohibitedRule({
  id: 'prohibited.counterfeit_fraud',
  description: 'Counterfeits and fraud devices (card skimmers, fake IDs, bump keys...)',
  unambiguous: [
    'card skimmer',
    'credit card skimmer',
    'atm skimmer',
    'atm overlay',
    'pin pad overlay',
    'replica badge',
    'police badge replica',
    'fake id',
    'fake ids',
    'fake license',
    'counterfeit',
    'bump key',
    'bump keys',
  ],
  ambiguous: ['replica', 'dupe', 'knockoff', 'knock off', 'lock pick', 'lockpick', 'key blank'],
})
