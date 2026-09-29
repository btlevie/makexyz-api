import vine from '@vinejs/vine'
import { SHIPPING_METHODS } from '#services/shipping_service'

/**
 * Anything bigger is a production run to quote by hand, not an instant quote -
 * and it keeps absurd values out of the pricing calculator.
 */
export const MAX_QUOTE_QUANTITY = 10_000

/** Whole parts only, at least one. */
const quantity = () => vine.number().withoutDecimals().min(1).max(MAX_QUOTE_QUANTITY)

export const createQuoteValidator = vine.create({
  items: vine
    .array(
      vine.object({
        projectFileUuid: vine.string().uuid(),
        quantity: quantity(),
      })
    )
    .minLength(1),
})

/**
 * Only the listed lines change; the rest of the quote keeps its quantities.
 * Lines are addressed by project file rather than quote item, since items are
 * recreated on every revision and a file appears at most once per quote.
 */
export const updateQuoteQuantitiesValidator = vine.create({
  items: vine
    .array(
      vine.object({
        projectFileUuid: vine.string().uuid(),
        quantity: quantity(),
      })
    )
    .minLength(1)
    .distinct('projectFileUuid'),
})

/**
 * ISO 3166-1 alpha-2 - validated as a valid-looking code here; whether it's
 * actually serviceable is a separate check against serviceable_countries
 * (isServiceableCountry), not something a format validator can express.
 */
export const configureQuoteValidator = vine.create({
  destinationCountry: vine.string().fixedLength(2).toUpperCase(),
  shippingMethod: vine.enum(SHIPPING_METHODS),
  productionTimeBusinessDays: vine.number().withoutDecimals().min(1),
  /**
   * Either addressUuid (an existing saved address) or the inline fields
   * below to create a new one - enforced in the controller, not here, same
   * pattern as payValidator's `email` field.
   */
  addressUuid: vine.string().uuid().optional(),
  shippingAddressLabel: vine.string().trim().maxLength(100).optional(),
  shippingRecipientName: vine.string().trim().maxLength(255).optional(),
  shippingLine1: vine.string().trim().maxLength(255).optional(),
  shippingLine2: vine.string().trim().maxLength(255).optional(),
  shippingCity: vine.string().trim().maxLength(255).optional(),
  shippingState: vine.string().trim().maxLength(255).optional(),
  shippingPostalCode: vine.string().trim().maxLength(20).optional(),
  /**
   * Required (in the controller) when the project has no customer yet - a
   * guest gives their email on the same form as the shipping address, so an
   * abandoned checkout still leaves someone to follow up with. Ignored for an
   * owned project.
   */
  email: vine.string().trim().email().maxLength(254).optional(),
  /** The guest's explicit follow-up-email choice - see lead_customer_service.ts. */
  marketingOptIn: vine.boolean().optional(),
})
