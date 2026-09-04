import vine from '@vinejs/vine'

/**
 * "Email this quote to yourself" - a lead-capture step offered after the price
 * is shown, not a signup. Deliberately no uniqueness rule against `users`: a
 * visitor who already has an account may still ask for the quote by email, and
 * rejecting them there would turn an optional convenience into a login prompt.
 */
export const captureProjectEmailValidator = vine.create({
  email: vine.string().trim().email().maxLength(254),
})
