import vine from '@vinejs/vine'

/**
 * Parcel as packed by the vendor. Weight in ounces, dimensions in inches -
 * EasyPost's units. Customs items are only required for international
 * destinations (enforced in shipment_service.ts, since that depends on the
 * order's address, not the request).
 */
export const createShipmentValidator = vine.create({
  parcel: vine.object({
    weightOz: vine.number().positive().max(2400),
    lengthIn: vine.number().positive().max(200),
    widthIn: vine.number().positive().max(200),
    heightIn: vine.number().positive().max(200),
  }),
  customsItems: vine
    .array(
      vine.object({
        description: vine.string().trim().maxLength(255),
        quantity: vine.number().withoutDecimals().positive(),
        /** Total declared value of the line in dollars, not per unit. */
        value: vine.number().positive(),
        weightOz: vine.number().positive(),
        hsTariffNumber: vine.string().trim().maxLength(20).optional(),
        originCountry: vine.string().fixedLength(2).toUpperCase().optional(),
      })
    )
    .minLength(1)
    .optional(),
})
