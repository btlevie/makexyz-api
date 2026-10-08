import { prohibitedRule } from '#services/moderation/rules/prohibited_shared'

/** Weapons other than firearms, and explosive/incendiary device parts. */
export default prohibitedRule({
  id: 'prohibited.weapon',
  description: 'Other weapons and explosive device parts (knuckles, gravity knives, pipe bombs...)',
  unambiguous: [
    'brass knuckles',
    'metal knuckles',
    'knuckle duster',
    'knuckle dusters',
    'knuckledusters',
    'gravity knife',
    'butterfly knife',
    'balisong',
    'push dagger',
    'switchblade',
    'pipe bomb',
    'detonator',
    'grenade body',
    'grenade shell',
    'explosive device',
  ],
  ambiguous: ['knife', 'dagger', 'baton', 'sword', 'tactical', 'grenade'],
})
