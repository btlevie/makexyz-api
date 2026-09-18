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
})
