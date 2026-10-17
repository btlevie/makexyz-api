import { prohibitedRule } from '#services/moderation/rules/prohibited_shared'

/**
 * Firearms and every firearm part or accessory - prohibited outright.
 * Built-in words: prohibited_terms.ts. Admins add slang and override
 * built-ins at runtime (moderation_terms).
 */
export default prohibitedRule({
  id: 'prohibited.firearm',
  category: 'firearm',
  description: 'Firearm parts and accessories (receivers, auto sears, suppressors...)',
})
