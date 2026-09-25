import vine from '@vinejs/vine'

export const TECHNOLOGIES = ['fdm', 'sla', 'sls'] as const

export const TAX_CLASSIFICATIONS = [
  'individual',
  'sole_prop',
  'c_corp',
  's_corp',
  'partnership',
  'llc',
  'foreign_individual',
  'foreign_entity',
] as const

export const TAX_FORM_TYPES = ['w9', 'w8ben', 'w8bene'] as const

export const updateVendorProfileValidator = vine.create({
  displayName: vine.string().trim().minLength(1).maxLength(255).optional(),
  legalName: vine.string().trim().minLength(1).maxLength(255).optional(),
  phone: vine.string().trim().maxLength(50).nullable().optional(),
})

/** The full set of technologies the vendor offers - see setCapabilities. */
export const setVendorCapabilitiesValidator = vine.create({
  technologies: vine.array(vine.enum(TECHNOLOGIES)).minLength(1).distinct(),
})

export const acceptVendorAgreementValidator = vine.create({
  version: vine.string().trim().minLength(1).maxLength(100),
})

export const uploadVendorTaxDocumentValidator = vine.create({
  taxClassification: vine.enum(TAX_CLASSIFICATIONS),
  formType: vine.enum(TAX_FORM_TYPES),
  file: vine.file({ size: '10mb', extnames: ['pdf'] }),
})
