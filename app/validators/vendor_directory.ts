import vine from '@vinejs/vine'
import { TECHNOLOGIES } from '#validators/vendor_onboarding'

export const SEARCH_SERVICE_VALUES = ['printing', 'design', 'scanning', 'cnc'] as const
export const VENDOR_SERVICE_VALUES = ['design', 'scanning', 'cnc'] as const
export const MAX_BIO_LENGTH = 2000

/** Decimal money string with up to 2 places - money is never a float (CLAUDE.md). */
const money = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/)

const sessionKey = () => vine.string().trim().maxLength(64)

/**
 * POST /v1/vendors/search. A POST so the searcher's location stays out of
 * URLs, access logs and caches. The location is coordinates plus address
 * parts from a Google Places pick (or browser geolocation), or a city page
 * slug, or nothing (reputation only).
 */
export const vendorSearchValidator = vine.create({
  lat: vine.number().min(-90).max(90).optional(),
  lng: vine.number().min(-180).max(180).optional().requiredIfExists('lat'),
  placeId: vine.string().trim().maxLength(255).optional(),
  postalCode: vine.string().trim().maxLength(20).optional(),
  city: vine.string().trim().maxLength(120).optional(),
  state: vine.string().trim().maxLength(120).optional(),
  country: vine.string().trim().fixedLength(2).optional(),
  locationSlug: vine.string().trim().maxLength(120).optional(),
  query: vine.string().trim().maxLength(255).optional(),
  service: vine.enum(SEARCH_SERVICE_VALUES).optional(),
  technology: vine.enum(TECHNOLOGIES).optional(),
  materialUuid: vine.string().trim().uuid().optional(),
  maxDistanceMiles: vine.number().min(1).max(5000).optional(),
  page: vine.number().withoutDecimals().min(1).max(500).optional(),
  perPage: vine.number().withoutDecimals().min(1).max(50).optional(),
  sessionKey: sessionKey().optional(),
})

/** PATCH /v1/vendor/profile. */
export const updatePublicProfileValidator = vine.create({
  displayName: vine.string().trim().minLength(1).maxLength(255).optional(),
  // 3-60 chars, lowercase letters, digits and inner hyphens: `acme-print`.
  profileSlug: vine
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/)
    .optional(),
  bio: vine.string().trim().maxLength(MAX_BIO_LENGTH).nullable().optional(),
  acceptingInquiries: vine.boolean().optional(),
  published: vine.boolean().optional(),
})

/** PUT /v1/vendor/profile/services - the full set offered beyond printing. */
export const setVendorServicesValidator = vine.create({
  services: vine
    .array(
      vine.object({
        service: vine.enum(VENDOR_SERVICE_VALUES),
        rate: money().nullable().optional(),
        rateUnit: vine.enum(['hour', 'project'] as const).optional(),
        description: vine.string().trim().maxLength(1000).nullable().optional(),
      })
    )
    .distinct('service'),
})

/** PUT /v1/vendor/profile/prices - indicative prices per cm3, by material. */
export const setIndicativePricesValidator = vine.create({
  prices: vine
    .array(
      vine.object({
        materialUuid: vine.string().trim().uuid(),
        pricePerCm3: vine
          .string()
          .trim()
          .regex(/^\d{1,6}(\.\d{1,4})?$/),
      })
    )
    .maxLength(100)
    .distinct('materialUuid'),
})

/** POST /v1/vendor/profile/images - a presigned upload for one image. */
export const createVendorImageValidator = vine.create({
  kind: vine.enum(['profile', 'portfolio'] as const),
  fileName: vine.string().trim().minLength(1).maxLength(255),
  sizeBytes: vine.number().withoutDecimals().min(1),
})

/** PUT /v1/vendor/profile/images/order - every portfolio image, in order. */
export const reorderPortfolioValidator = vine.create({
  uuids: vine.array(vine.string().trim().uuid()).maxLength(50).distinct(),
})

/** POST /v1/analytics/landing-visits - recorded by the frontend. */
export const landingVisitValidator = vine.create({
  path: vine.string().trim().startsWith('/').maxLength(512),
  referrer: vine.string().trim().maxLength(512).nullable().optional(),
  sessionKey: sessionKey().optional(),
})

/** Admin: take a profile out of the directory. */
export const adminUnpublishProfileValidator = vine.create({
  reason: vine.string().trim().maxLength(500).optional(),
})

/** Admin: turn a vendor's listed service off or back on. */
export const adminSetServiceValidator = vine.create({
  active: vine.boolean(),
  reason: vine.string().trim().maxLength(500).optional(),
})
