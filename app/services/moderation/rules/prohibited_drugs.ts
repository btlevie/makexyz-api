import { prohibitedRule } from '#services/moderation/rules/prohibited_shared'

/**
 * Drug paraphernalia and equipment for making or taking controlled substances.
 * Built-in words: prohibited_terms.ts. Admins add slang and override
 * built-ins at runtime (moderation_terms).
 */
export default prohibitedRule({
  id: 'prohibited.drugs',
  category: 'drugs',
  description: 'Drug paraphernalia and pill-press parts',
})
