import vine from '@vinejs/vine'

export const splitQuoteValidator = vine.create({
  groups: vine
    .array(
      vine.object({
        projectFileUuids: vine.array(vine.string().uuid()).minLength(1),
      })
    )
    .minLength(2),
})
