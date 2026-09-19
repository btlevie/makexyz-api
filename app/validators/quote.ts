import vine from '@vinejs/vine'

export const createQuoteValidator = vine.create({
  items: vine
    .array(
      vine.object({
        projectFileUuid: vine.string().uuid(),
        // Whole parts only, at least one.
        quantity: vine.number().withoutDecimals().min(1),
      })
    )
    .minLength(1),
})

/**
 * ISO 3166-1 alpha-2 - validated as a valid-looking code here; whether it's
 * actually serviceable is a separate check against serviceable_countries
 * (isServiceableCountry), not something a format validator can express.
 */
export const configureQuoteValidator = vine.create({
  destinationCountry: vine.string().fixedLength(2).toUpperCase(),
  shippingMethod: vine.enum(['free', 'ups_2day', 'ups_overnight', 'international_expedited'] as const),
  productionTimeBusinessDays: vine.number().withoutDecimals().min(1),
  /**
   * Either addressUuid (an existing saved address) or the inline fields
   * below to create a new one - enforced in the controller, not here, same
   * pattern as createCheckoutSessionValidator's `email` field.
   */
  addressUuid: vine.string().uuid().optional(),
  shippingAddressLabel: vine.string().trim().maxLength(100).optional(),
  shippingRecipientName: vine.string().trim().maxLength(255).optional(),
  shippingLine1: vine.string().trim().maxLength(255).optional(),
  shippingLine2: vine.string().trim().maxLength(255).optional(),
  shippingCity: vine.string().trim().maxLength(255).optional(),
  shippingState: vine.string().trim().maxLength(255).optional(),
  shippingPostalCode: vine.string().trim().maxLength(20).optional(),
})
