import { prohibitedRule } from '#services/moderation/rules/prohibited_shared'

/**
 * Counterfeit/IP knock-offs and devices for fraud or getting into others' property.
 * Built-in words: prohibited_terms.ts. Admins add slang and override
 * built-ins at runtime (moderation_terms).
 */
export default prohibitedRule({
  id: 'prohibited.counterfeit_fraud',
  category: 'counterfeit_fraud',
  description: 'Counterfeits and fraud devices (card skimmers, fake IDs, bump keys...)',
})
