import vine from '@vinejs/vine'

export const newCustomerValidator = vine.create({
  firstName: vine.string().trim(),
  lastName: vine.string().trim(),
  email: vine.string().email().unique({ table: 'users', column: 'email' }),
  password: vine.string().trim().minLength(8),
})
