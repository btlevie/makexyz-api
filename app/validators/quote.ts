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
