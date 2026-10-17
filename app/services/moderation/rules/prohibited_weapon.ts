import { prohibitedRule } from '#services/moderation/rules/prohibited_shared'

/**
 * Weapons other than firearms, and explosive/incendiary device parts.
 * Built-in words: prohibited_terms.ts. Admins add slang and override
 * built-ins at runtime (moderation_terms).
 */
export default prohibitedRule({
  id: 'prohibited.weapon',
  category: 'weapon',
  description: 'Other weapons and explosive device parts (knuckles, gravity knives, pipe bombs...)',
})
