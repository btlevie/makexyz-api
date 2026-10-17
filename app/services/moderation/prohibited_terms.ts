/**
 * The built-in prohibited-item word lists - the baseline admins adjust at
 * runtime through moderation_terms (see term_registry.ts and
 * docs/plans/messaging_moderation.md). Changing a list here changes the
 * default for every environment; a one-off addition or a false positive is
 * better handled from the admin terms endpoints.
 *
 * - `unambiguous` terms block and open a prohibited-item case.
 * - `ambiguous` terms are common in honest manufacturing talk ("trigger",
 *   "blade", "grinder"), so they only add weight by default.
 */

export const PROHIBITED_CATEGORIES = ['firearm', 'weapon', 'drugs', 'counterfeit_fraud'] as const
export type ProhibitedCategory = (typeof PROHIBITED_CATEGORIES)[number]

export interface BuiltinCategoryTerms {
  unambiguous: readonly string[]
  ambiguous: readonly string[]
}

export const BUILTIN_PROHIBITED_TERMS: Record<ProhibitedCategory, BuiltinCategoryTerms> = {
  firearm: {
    unambiguous: [
      'auto sear',
      'autosear',
      'drop in auto sear',
      'glock switch',
      'glock switches',
      'switch for glock',
      // Not bare "auto switch" or "conversion device" - both are ordinary
      // electronics terms ("auto switch relay", "voltage conversion device").
      'lightning link',
      '80% lower',
      '80 percent lower',
      '80 lower',
      '80% jig',
      '80 lower jig',
      'lower receiver',
      'upper receiver',
      'ghost gun',
      'solvent trap',
      'gun suppressor',
      'rifle suppressor',
      'pistol suppressor',
      'firearm suppressor',
      'gun silencer',
      'pistol silencer',
      'rifle silencer',
      'bump stock',
      'forced reset trigger',
      'machine gun conversion',
      'full auto conversion',
      'fgc-9',
      'fgc9',
      'pistol frame',
      'gun frame',
      'firearm frame',
    ],
    ambiguous: [
      'ar-15',
      'ar15',
      'ar 15',
      'ar-10',
      'glock',
      'handgun',
      'firearm',
      'rifle',
      'shotgun',
      'pistol grip',
      'buffer tube',
      'mag release',
      'trigger group',
      'trigger pack',
      'suppressor',
      'silencer',
      '9mm',
      '.223',
      '5.56',
      '.45 acp',
    ],
  },
  weapon: {
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
  },
  drugs: {
    unambiguous: [
      'pill press die',
      'pill press dies',
      'tablet press die',
      'tablet press punch',
      'pill punch',
      'bong',
      'bongs',
      'dab rig',
      'crack pipe',
      'meth pipe',
      'one hitter',
      'weed grinder',
      'weed pipe',
    ],
    ambiguous: ['pill press', 'grinder', 'weed', 'cannabis', 'thc', '420'],
  },
  counterfeit_fraud: {
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
  },
}

/** Context that makes a weapon-ish term usually innocent. Lowers block to escalate. */
export const BUILTIN_CONTEXT_ALLOWLIST: readonly string[] = [
  'airsoft',
  'nerf',
  'cosplay',
  'prop',
  'props',
  'prop replica',
  'non functional',
  'non-functional',
  'toy',
  'model kit',
  'scale model',
  'display stand',
  'display case',
  'wall mount',
  'gun rack',
  'magazine rack',
  'magazine holder',
  'magazine file',
  'knife block',
  'knife holder',
]
