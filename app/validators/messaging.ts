import vine from '@vinejs/vine'

/** Longest message body accepted, in characters. */
export const MAX_MESSAGE_LENGTH = 4000

function messageBody() {
  return vine.string().trim().minLength(1).maxLength(MAX_MESSAGE_LENGTH)
}

/**
 * Client-generated idempotency key - a retried send with the same key
 * returns the original message instead of creating a second one.
 */
function clientMessageId() {
  return vine.string().uuid()
}

export const sendMessageValidator = vine.create({
  body: messageBody(),
  clientMessageId: clientMessageId(),
})

export const createInquiryValidator = vine.create({
  subject: vine.string().trim().minLength(3).maxLength(200),
  body: messageBody(),
  clientMessageId: clientMessageId(),
})

export const markReadValidator = vine.create({
  seq: vine.number().withoutDecimals().min(0),
})

export const listMessagesValidator = vine.create({
  afterSeq: vine.number().withoutDecimals().min(0).optional(),
  limit: vine.number().withoutDecimals().range([1, 100]).optional(),
})

export const closeConversationValidator = vine.create({
  reason: vine.string().trim().maxLength(500).optional(),
})

export const declineInquiryValidator = vine.create({
  reason: vine.string().trim().maxLength(500).optional(),
  // 'prohibited_item' also opens a moderation case - vendors are the second
  // line of defence against prohibited work the text rules can't see.
  reasonCode: vine.enum(['not_a_fit', 'no_capacity', 'prohibited_item', 'other']).optional(),
})

export const reportMessageValidator = vine.create({
  reason: vine.enum([
    'contact_sharing',
    'payment',
    'spam_ad',
    'scam',
    'harassment',
    'prohibited_item',
    'other',
  ]),
  note: vine.string().trim().maxLength(1000).optional(),
})

export const updateRuleValidator = vine.create({
  mode: vine.enum(['off', 'shadow', 'enforce']).optional(),
  config: vine.record(vine.any()).optional(),
  reason: vine.string().trim().maxLength(1000).optional(),
})

const TERM_CATEGORIES = [
  'firearm',
  'weapon',
  'drugs',
  'counterfeit_fraud',
  'context_allow',
] as const

export const listTermsValidator = vine.create({
  category: vine.enum(TERM_CATEGORIES).optional(),
  status: vine.enum(['active', 'shadow', 'disabled']).optional(),
  q: vine.string().trim().maxLength(60).optional(),
})

export const addTermValidator = vine.create({
  category: vine.enum(TERM_CATEGORIES),
  term: vine.string().trim().minLength(2).maxLength(60),
  action: vine.enum(['block', 'review', 'weight']).optional(),
  status: vine.enum(['active', 'shadow', 'disabled']).optional(),
  note: vine.string().trim().maxLength(1000).optional(),
})

export const updateTermValidator = vine.create({
  action: vine.enum(['block', 'review', 'weight']).optional(),
  status: vine.enum(['active', 'shadow', 'disabled']).optional(),
  note: vine.string().trim().maxLength(1000).optional(),
})

export const previewTermValidator = vine.create({
  category: vine.enum(TERM_CATEGORIES),
  term: vine.string().trim().minLength(2).maxLength(60),
})

export const restrictSubjectValidator = vine.create({
  tier: vine.enum(['restricted', 'suspended', 'standard']),
  days: vine.number().withoutDecimals().range([1, 365]).optional(),
  note: vine.string().trim().maxLength(2000).optional(),
})

export const resolveCaseValidator = vine.create({
  note: vine.string().trim().maxLength(2000).optional(),
})

export const adminListConversationsValidator = vine.create({
  kind: vine.enum(['inquiry', 'order', 'support']).optional(),
  status: vine.enum(['open', 'read_only', 'archived']).optional(),
})

export const adminListCasesValidator = vine.create({
  status: vine.enum(['open', 'claimed', 'resolved']).optional(),
})
