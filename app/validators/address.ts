import vine from '@vinejs/vine'

export const createAddressValidator = vine.create({
  label: vine.string().trim().maxLength(100).optional(),
  recipientName: vine.string().trim().maxLength(255),
  line1: vine.string().trim().maxLength(255),
  line2: vine.string().trim().maxLength(255).optional(),
  city: vine.string().trim().maxLength(255),
  state: vine.string().trim().maxLength(255).optional(),
  postalCode: vine.string().trim().maxLength(20),
  country: vine.string().fixedLength(2).toUpperCase(),
  isDefault: vine.boolean().optional(),
})

export const updateAddressValidator = vine.create({
  label: vine.string().trim().maxLength(100).optional(),
  recipientName: vine.string().trim().maxLength(255).optional(),
  line1: vine.string().trim().maxLength(255).optional(),
  line2: vine.string().trim().maxLength(255).optional(),
  city: vine.string().trim().maxLength(255).optional(),
  state: vine.string().trim().maxLength(255).optional(),
  postalCode: vine.string().trim().maxLength(20).optional(),
  country: vine.string().fixedLength(2).toUpperCase().optional(),
  isDefault: vine.boolean().optional(),
})
