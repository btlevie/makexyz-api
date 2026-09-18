import vine from '@vinejs/vine'

/**
 * email is only required when the project has no Customer attached yet (a
 * guest who skipped the optional lead-capture step) - enforced in the
 * controller, not here, since whether it's required depends on project state.
 */
export const createCheckoutSessionValidator = vine.create({
  email: vine.string().email().optional(),
})

export const authorizeCheckoutSessionValidator = vine.create({
  provider: vine.enum(['stripe', 'paypal'] as const),
  // Frontend-collected payment credential - a Stripe PaymentMethod id, or a
  // PayPal approved order id. Optional here because the in-memory Fake
  // gateway (test env) doesn't need one; the real gateways require it.
  providerToken: vine.string().optional(),
})
