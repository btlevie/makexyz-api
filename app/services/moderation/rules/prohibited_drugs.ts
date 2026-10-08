import { prohibitedRule } from '#services/moderation/rules/prohibited_shared'

/** Drug paraphernalia and equipment for making or taking controlled substances. */
export default prohibitedRule({
  id: 'prohibited.drugs',
  description: 'Drug paraphernalia and pill-press parts',
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
})
