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
