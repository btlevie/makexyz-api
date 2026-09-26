import vine from '@vinejs/vine'

/**
 * Same format rule as configureQuoteValidator's destinationCountry, so a code
 * accepted here is accepted there. Serviceability is checked in the
 * controller (isServiceableCountry), as in configure.
 */
export const listShippingOptionsValidator = vine.create({
  country: vine.string().fixedLength(2).toUpperCase(),
})
