import vine from '@vinejs/vine'

/** Accepted values for GET /v1/admin/vendors?status=. */
export const VENDOR_STATUSES: readonly string[] = [
  'onboarding',
  'pending_review',
  'active',
  'suspended',
]

/** `isPreferred` only applies to an approved capability - see reviewCapability. */
export const reviewCapabilityValidator = vine.create({
  status: vine.enum(['approved', 'rejected'] as const),
  isPreferred: vine.boolean().optional(),
})

export const rejectTaxDocumentValidator = vine.create({
  reason: vine.string().trim().minLength(1).maxLength(255),
})

export const suspendVendorValidator = vine.create({
  reason: vine.string().trim().minLength(1).maxLength(255),
})
