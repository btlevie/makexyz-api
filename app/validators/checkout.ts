import vine from '@vinejs/vine'

/**
 * Checkout in one call (CheckoutSessionsController#pay).
 *
 * `providerToken` is the frontend-collected payment credential - a Stripe
 * PaymentMethod id, or a PayPal approved order id. Optional here because the
 * in-memory Fake gateway (test env) doesn't need one; the real gateways
 * require it.
 *
 * `email` is only required when the project has no Customer attached yet
 * (a quote staff configured on a guest's behalf - configure otherwise
 * requires one) - enforced in the controller, not here, since whether it's
 * required depends on project state.
 */
export const payValidator = vine.create({
  provider: vine.enum(['stripe', 'paypal'] as const),
  providerToken: vine.string().optional(),
  email: vine.string().email().optional(),
})
