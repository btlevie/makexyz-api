/**
 * Vendor public profiles - the directory side of docs/plans/manual_quotes.md
 * (section 2). A vendor is listed only when it is active, accepting
 * inquiries, published, and its public text is approved (Vendor#isListed /
 * whereListed below).
 *
 * Public text (display name, bio, service descriptions) goes through the
 * message moderation pipeline before it's saved (content_moderation_service.ts):
 * a block is refused with the reason; anything a person must check is saved
 * but keeps the vendor out of the directory until a moderator approves it.
 *
 * Capabilities shown are approved vendor_technology_capabilities; materials
 * are the ones an admin set payout rates for (approved to make) - there's no
 * second, self-declared materials list to drift.
 */
import string from '@adonisjs/core/helpers/string'
import db from '@adonisjs/lucid/services/db'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { DateTime } from 'luxon'
import AuditEvent from '#models/audit_event'
import Material from '#models/material'
import Vendor from '#models/vendor'
import VendorImage from '#models/vendor_image'
import VendorIndicativePrice from '#models/vendor_indicative_price'
import VendorPayoutRate from '#models/vendor_payout_rate'
import VendorService from '#models/vendor_service'
import VendorTechnologyCapability from '#models/vendor_technology_capability'
import type User from '#models/user'
import { moderateContent } from '#services/content_moderation_service'
import { recordModerationAction } from '#services/moderation_action_service'
import { imageUrls, type ImageUrls } from '#services/vendor_image_service'
import { priceTier } from '#services/vendor_ranking'

type Technology = VendorTechnologyCapability['technology']
type ServiceName = VendorService['service']

/** Slugs that would collide with directory routes or read as official. */
export const RESERVED_SLUGS = [
  'search',
  'similar',
  'profile',
  'me',
  'new',
  'admin',
  'makexyz',
  'support',
  'locations',
]

export class ProfileError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 422 = 422
  ) {
    super(message)
    this.name = 'ProfileError'
  }
}

/** The text was blocked by moderation - nothing was saved. */
export class ProfileBlockedError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'ProfileBlockedError'
  }
}

/** The SQL form of Vendor#isListed - keep them in sync. */
export function whereListed(query: ModelQueryBuilderContract<typeof Vendor>) {
  return query
    .where('vendors.status', 'active')
    .where('vendors.accepting_inquiries', true)
    .whereNotNull('vendors.profile_published_at')
    .whereNotNull('vendors.profile_slug')
    .where('vendors.profile_moderation_status', 'approved')
}

async function audit(
  vendor: Vendor,
  userId: number | null,
  action: string,
  details: Record<string, unknown> = {}
) {
  await AuditEvent.create({
    entityType: 'vendor',
    entityId: vendor.id,
    eventType: 'updated',
    userId,
    payload: { action, vendorUuid: vendor.uuid, ...details },
  })
}

function assertNotSuspended(vendor: Vendor) {
  if (vendor.status === 'suspended') {
    throw new ProfileError('Suspended vendors cannot change their public profile', 409)
  }
}

/** Everything public a vendor writes, moderated together. */
function profileText(
  vendor: Pick<Vendor, 'displayName' | 'bio'>,
  serviceDescriptions: (string | null)[]
): string {
  return [vendor.displayName, vendor.bio, ...serviceDescriptions]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join('\n\n')
}

async function currentServiceDescriptions(vendorId: number): Promise<(string | null)[]> {
  const services = await VendorService.query().where('vendorId', vendorId)
  return services.filter((service) => service.active).map((service) => service.description)
}

/**
 * Moderates the vendor's would-be public text. Throws ProfileBlockedError on
 * a block; otherwise returns the moderation status to save with it.
 */
async function moderateProfile(
  vendor: Vendor,
  next: { displayName: string | null; bio: string | null },
  serviceDescriptions: (string | null)[]
): Promise<Vendor['profileModerationStatus']> {
  const text = profileText(next, serviceDescriptions)
  if (!text) return 'approved'
  const result = await moderateContent(
    { type: 'vendor_profile', id: vendor.id, vendorId: vendor.id },
    text
  )
  if (result.status === 'blocked') {
    throw new ProfileBlockedError(result.reason!)
  }
  return result.status
}

/**
 * Moderates a display-name change made through onboarding (the same public
 * text as the profile). Throws ProfileBlockedError on a block.
 */
export async function moderateDisplayName(vendor: Vendor, displayName: string): Promise<void> {
  if (displayName === vendor.displayName) return
  vendor.profileModerationStatus = await moderateProfile(
    vendor,
    { displayName, bio: vendor.bio },
    await currentServiceDescriptions(vendor.id)
  )
}

async function assertSlugAvailable(vendor: Vendor, slug: string) {
  if (RESERVED_SLUGS.includes(slug)) {
    throw new ProfileError('That profile address is reserved - choose another')
  }
  const taken = await Vendor.query().where('profileSlug', slug).whereNot('id', vendor.id).first()
  if (taken) {
    throw new ProfileError('That profile address is taken - choose another', 409)
  }
}

/** A free slug from the display name: `acme-print`, `acme-print-2`... */
async function generateSlug(vendor: Vendor): Promise<string> {
  const base =
    string.slug(vendor.displayName ?? 'vendor', { lower: true, strict: true }).slice(0, 60) ||
    'vendor'
  let candidate = RESERVED_SLUGS.includes(base) ? `${base}-shop` : base
  for (let suffix = 2; ; suffix++) {
    const taken = await Vendor.query()
      .where('profileSlug', candidate)
      .whereNot('id', vendor.id)
      .first()
    if (!taken) return candidate
    candidate = `${base}-${suffix}`
  }
}

export interface ProfileInput {
  displayName?: string
  profileSlug?: string
  bio?: string | null
  acceptingInquiries?: boolean
  /** true publishes (keeping the first publish date), false unpublishes. */
  published?: boolean
}

export async function updatePublicProfile(vendor: Vendor, input: ProfileInput): Promise<Vendor> {
  assertNotSuspended(vendor)

  if (input.profileSlug !== undefined && input.profileSlug !== vendor.profileSlug) {
    await assertSlugAvailable(vendor, input.profileSlug)
  }

  const next = {
    displayName: input.displayName ?? vendor.displayName,
    bio: input.bio !== undefined ? input.bio || null : vendor.bio,
  }
  const textChanged = next.displayName !== vendor.displayName || next.bio !== vendor.bio
  const moderationStatus = textChanged
    ? await moderateProfile(vendor, next, await currentServiceDescriptions(vendor.id))
    : vendor.profileModerationStatus

  vendor.merge({
    displayName: next.displayName,
    bio: next.bio,
    profileModerationStatus: moderationStatus,
  })
  if (input.profileSlug !== undefined) vendor.profileSlug = input.profileSlug
  if (input.acceptingInquiries !== undefined) vendor.acceptingInquiries = input.acceptingInquiries

  if (input.published === true) {
    if (!vendor.displayName) {
      throw new ProfileError('Add a display name before publishing your profile')
    }
    vendor.profileSlug ??= await generateSlug(vendor)
    vendor.profilePublishedAt ??= DateTime.now()
  } else if (input.published === false) {
    vendor.profilePublishedAt = null
  }

  await vendor.save()
  return vendor
}

export interface ServiceInput {
  service: ServiceName
  rate?: string | null
  rateUnit?: VendorService['rateUnit']
  description?: string | null
}

/**
 * Replaces the vendor's offered services: listed ones are created or
 * updated (and switched on), ones not listed are switched off. Rows are kept,
 * so a service an admin turned off stays off.
 */
export async function setServices(
  vendor: Vendor,
  services: ServiceInput[]
): Promise<VendorService[]> {
  assertNotSuspended(vendor)
  const existing = await VendorService.query().where('vendorId', vendor.id)
  const byService = new Map(existing.map((row) => [row.service, row]))

  const descriptionsChanged = services.some(
    (input) => (input.description ?? null) !== (byService.get(input.service)?.description ?? null)
  )
  const moderationStatus = descriptionsChanged
    ? await moderateProfile(
        vendor,
        { displayName: vendor.displayName, bio: vendor.bio },
        services.map((input) => input.description ?? null)
      )
    : vendor.profileModerationStatus

  const wanted = new Set(services.map((input) => input.service))
  await db.transaction(async (trx) => {
    for (const input of services) {
      const values = {
        active: true,
        rate: input.rate ?? null,
        rateUnit: input.rate ? (input.rateUnit ?? 'hour') : null,
        description: input.description ?? null,
      }
      const row = byService.get(input.service)
      if (row) {
        row.useTransaction(trx)
        row.merge(values)
        await row.save()
      } else {
        await VendorService.create(
          { vendorId: vendor.id, service: input.service, ...values },
          { client: trx }
        )
      }
    }
    for (const row of existing) {
      if (!wanted.has(row.service) && row.active) {
        row.useTransaction(trx)
        row.active = false
        await row.save()
      }
    }
    vendor.useTransaction(trx)
    vendor.profileModerationStatus = moderationStatus
    await vendor.save()
  })

  return VendorService.query().where('vendorId', vendor.id).orderBy('service', 'asc')
}

/** Replaces the vendor's published prices per cm3 (the "$ to $$$$" indicator). */
export async function setIndicativePrices(
  vendor: Vendor,
  prices: { materialUuid: string; pricePerCm3: string }[]
): Promise<VendorIndicativePrice[]> {
  assertNotSuspended(vendor)
  const materials = await Material.query().whereIn(
    'uuid',
    prices.map((price) => price.materialUuid)
  )
  const byUuid = new Map(materials.map((material) => [material.uuid, material]))
  const missing = prices.find((price) => !byUuid.has(price.materialUuid))
  if (missing) {
    throw new ProfileError(`Unknown material ${missing.materialUuid}`)
  }

  await db.transaction(async (trx) => {
    await VendorIndicativePrice.query({ client: trx }).where('vendorId', vendor.id).delete()
    if (prices.length > 0) {
      await VendorIndicativePrice.createMany(
        prices.map((price) => ({
          vendorId: vendor.id,
          materialId: byUuid.get(price.materialUuid)!.id,
          pricePerCubicCm: price.pricePerCm3,
        })),
        { client: trx }
      )
    }
  })
  return VendorIndicativePrice.query().where('vendorId', vendor.id).preload('material')
}

/* ------------------------------------------------------------------------ */
/* Moderator and admin actions                                                */
/* ------------------------------------------------------------------------ */

/** A moderator approved the profile text a case was about. */
export async function approveProfileText(vendor: Vendor) {
  vendor.profileModerationStatus = 'approved'
  await vendor.save()
}

/** A moderator blocked the profile text: the vendor leaves the directory until they edit it. */
export async function rejectProfileText(vendor: Vendor) {
  vendor.profileModerationStatus = 'rejected'
  await vendor.save()
}

/** Takes a profile out of the directory. The vendor can publish again; repeat cases are a moderation matter. */
export async function adminUnpublish(vendor: Vendor, admin: User, reason?: string) {
  vendor.profilePublishedAt = null
  await vendor.save()
  await recordModerationAction({
    actorUserId: admin.id,
    action: 'unpublish_profile',
    targetType: 'vendor',
    targetId: vendor.uuid,
    reason,
  })
  await audit(vendor, admin.id, 'profile_unpublished', { reason: reason ?? null })
}

/** Turns a listed service off (or back on). While off, the vendor can't re-enable it. */
export async function adminSetServiceActive(
  vendor: Vendor,
  service: ServiceName,
  active: boolean,
  admin: User,
  reason?: string
): Promise<VendorService> {
  const row = await VendorService.query()
    .where('vendorId', vendor.id)
    .where('service', service)
    .first()
  if (!row) {
    throw new ProfileError(`This vendor doesn't offer ${service}`, 422)
  }
  row.adminDisabledAt = active ? null : DateTime.now()
  await row.save()
  await recordModerationAction({
    actorUserId: admin.id,
    action: active ? 'enable_service' : 'disable_service',
    targetType: 'vendor',
    targetId: vendor.uuid,
    reason,
    metadata: { service },
  })
  return row
}

/* ------------------------------------------------------------------------ */
/* What the directory shows                                                   */
/* ------------------------------------------------------------------------ */

export interface DirectoryData {
  technologies: Technology[]
  materials: { uuid: string; name: string; technology: Technology }[]
  services: {
    service: ServiceName
    rate: string | null
    rateUnit: VendorService['rateUnit']
    description: string | null
  }[]
  priceTier: 1 | 2 | 3 | 4 | null
  profileImage: ImageUrls | null
  portfolio: ImageUrls[]
}

/**
 * The public capability data for a set of vendors, in a handful of batched
 * queries. `withPortfolio` adds portfolio images (the profile page, not
 * search cards).
 */
export async function loadDirectoryData(
  vendorIds: number[],
  options: { withPortfolio?: boolean } = {}
): Promise<Map<number, DirectoryData>> {
  const data = new Map<number, DirectoryData>()
  if (vendorIds.length === 0) return data
  for (const id of vendorIds) {
    data.set(id, {
      technologies: [],
      materials: [],
      services: [],
      priceTier: null,
      profileImage: null,
      portfolio: [],
    })
  }

  const [capabilities, rates, services, prices, images] = await Promise.all([
    VendorTechnologyCapability.query()
      .whereIn('vendorId', vendorIds)
      .where('status', 'approved')
      .orderBy('technology', 'asc'),
    VendorPayoutRate.query().whereIn('vendorId', vendorIds).preload('material'),
    VendorService.query()
      .whereIn('vendorId', vendorIds)
      .where('active', true)
      .whereNull('adminDisabledAt')
      .orderBy('service', 'asc'),
    VendorIndicativePrice.query().whereIn('vendorId', vendorIds),
    VendorImage.query()
      .whereIn('vendorId', vendorIds)
      .where('status', 'approved')
      .whereIn('kind', options.withPortfolio ? ['profile', 'portfolio'] : ['profile'])
      .orderBy('position', 'asc')
      .orderBy('id', 'asc'),
  ])

  for (const capability of capabilities) {
    data.get(capability.vendorId)!.technologies.push(capability.technology)
  }
  for (const rate of rates) {
    const entry = data.get(rate.vendorId)!
    // Approved to make it: a payout rate, and the technology approved too.
    if (rate.material && entry.technologies.includes(rate.material.technology)) {
      entry.materials.push({
        uuid: rate.material.uuid,
        name: rate.material.name,
        technology: rate.material.technology,
      })
    }
  }
  for (const entry of data.values()) {
    entry.materials.sort((a, b) => a.name.localeCompare(b.name))
  }
  for (const service of services) {
    data.get(service.vendorId)!.services.push({
      service: service.service,
      rate: service.rate,
      rateUnit: service.rateUnit,
      description: service.description,
    })
  }
  const cheapest = new Map<number, number>()
  for (const price of prices) {
    const value = Number(price.pricePerCubicCm)
    const current = cheapest.get(price.vendorId)
    if (current === undefined || value < current) cheapest.set(price.vendorId, value)
  }
  for (const [vendorId, value] of cheapest) {
    data.get(vendorId)!.priceTier = priceTier(value)
  }
  for (const image of images) {
    const entry = data.get(image.vendorId)!
    const urls = await imageUrls(image)
    if (!urls) continue
    if (image.kind === 'profile') entry.profileImage = urls
    else entry.portfolio.push(urls)
  }
  return data
}

/** The listed vendor behind a public profile slug, or null. */
export async function findListedBySlug(slug: string): Promise<Vendor | null> {
  return whereListed(Vendor.query()).where('vendors.profile_slug', slug).first()
}
