import vine from '@vinejs/vine'

/**
 * "Email this quote to yourself" - an optional lead-capture step offered after
 * the price is shown, not a signup. Deliberately no uniqueness rule against
 * `users`: a visitor who already has an account may still ask for the quote
 * by email, and rejecting them there would turn an optional convenience into
 * a login prompt. `marketingOptIn` is the guest's explicit follow-up-email
 * choice (see lead_customer_service.ts).
 */
export const captureProjectEmailValidator = vine.create({
  email: vine.string().trim().email().maxLength(254),
  marketingOptIn: vine.boolean().optional(),
})
