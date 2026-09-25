/**
 * Vendor onboarding: the checklists that decide whether a vendor is ready, and
 * every status transition from 'onboarding' through 'active'/'suspended'.
 *
 * This is the single source of truth for readiness - controllers, the user
 * transformer's `onboardingComplete` flag and tests all read it from here
 * rather than re-deriving any piece of it. The full process (states,
 * checklists, endpoints, frontend routing) is documented in
 * docs/VENDOR_ONBOARDING.md - update that in the same change as this file.
 *
 * Gating on the result lives elsewhere, next to what it gates:
 * order_routing_service.ts (routing/fulfillability), order_acceptance_service.ts
 * (acceptance) and project_grant_service.ts (staff project access).
 */
import db from '@adonisjs/lucid/services/db'
import string from '@adonisjs/core/helpers/string'
import type { HttpContext } from '@adonisjs/core/http'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import env from '#start/env'
import Address from '#models/address'
import AuditEvent from '#models/audit_event'
import Material from '#models/material'
import Vendor from '#models/vendor'
import VendorPayoutRate from '#models/vendor_payout_rate'
import VendorTaxDocument from '#models/vendor_tax_document'
import VendorTechnologyCapability from '#models/vendor_technology_capability'
import { isPayoutMethodReady } from '#services/vendor_payout_method_service'

type Technology = VendorTechnologyCapability['technology']
type TaxClassification = NonNullable<Vendor['taxClassification']>
type TaxFormType = VendorTaxDocument['formType']

/** The transition isn't allowed from the vendor's current status. */
export class VendorStatusError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VendorStatusError'
  }
}

/** A transition's checklist isn't complete - carries the checklist(s) so the caller can show what's missing. */
export class ChecklistIncompleteError extends Error {
  constructor(
    message: string,
    readonly checklist: ChecklistItem[],
    readonly adminChecklist?: ChecklistItem[]
  ) {
    super(message)
    this.name = 'ChecklistIncompleteError'
  }
}

/** The vendor tried to accept an agreement version other than the current one. */
export class AgreementVersionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgreementVersionError'
  }
}

/** An admin tried to review a capability the vendor never requested. */
export class CapabilityNotRequestedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityNotRequestedError'
  }
}

/** The vendor has no tax document to act on. */
export class TaxDocumentNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxDocumentNotFoundError'
  }
}

/** The current tax document was already verified or rejected. */
export class TaxDocumentAlreadyReviewedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxDocumentAlreadyReviewedError'
  }
}

export type ChecklistItem = {
  key: string
  complete: boolean
  /** Why it's incomplete (null when complete) - shown as-is by the frontend. */
  detail: string | null
}

export type OnboardingSnapshot = {
  capabilities: VendorTechnologyCapability[]
  taxDocument: VendorTaxDocument | null
  checklist: ChecklistItem[]
  onboardingComplete: boolean
}

/**
 * Resolves the calling user's Vendor record, or null if they aren't a vendor
 * at all. No established policy/ability convention exists yet in this
 * codebase (see CLAUDE.md) - a manual role check, same as `isStaff` in
 * project_grant_service.ts.
 */
export async function resolveVendor(ctx: HttpContext): Promise<Vendor | null> {
  const user = ctx.auth.getUserOrFail()
  if (user.role !== 'vendor') {
    return null
  }
  return Vendor.findBy('userId', user.id)
}

/**
 * The agreement version currently in force, or null if VENDOR_AGREEMENT_VERSION
 * isn't configured (non-production only - env.ts requires it in production).
 * Unconfigured means no vendor can complete the agreement step, rather than
 * every vendor silently passing it.
 *
 * TODO(mail): there's no code path that runs when the version is bumped (it's
 * an env change) - once mail exists, add a one-off command/job that emails
 * every active vendor whose agreementVersion is stale, asking them to
 * re-accept before they can accept new orders.
 */
export function currentAgreementVersion(): string | null {
  return env.get('VENDOR_AGREEMENT_VERSION') || null
}

/** Whether the vendor has accepted the agreement version currently in force. */
export function hasCurrentAgreement(vendor: Vendor): boolean {
  const current = currentAgreementVersion()
  return current !== null && vendor.agreementVersion === current
}

export async function latestTaxDocument(
  vendorId: number,
  trx?: TransactionClientContract
): Promise<VendorTaxDocument | null> {
  return VendorTaxDocument.query(trx ? { client: trx } : {})
    .where('vendorId', vendorId)
    .orderBy('id', 'desc')
    .first()
}

function item(key: string, complete: boolean, detail: string): ChecklistItem {
  return { key, complete, detail: complete ? null : detail }
}

/**
 * Everything the vendor themselves has to complete - `onboardingComplete` is
 * all of these, and submitting for review requires it.
 */
export async function getOnboardingSnapshot(vendor: Vendor): Promise<OnboardingSnapshot> {
  const [capabilities, taxDocument, defaultAddress] = await Promise.all([
    VendorTechnologyCapability.query().where('vendorId', vendor.id).orderBy('technology', 'asc'),
    latestTaxDocument(vendor.id),
    Address.query()
      .where('vendorId', vendor.id)
      .where('ownerType', 'vendor')
      .where('isDefault', true)
      .first(),
  ])

  const agreementVersion = currentAgreementVersion()
  const checklist: ChecklistItem[] = [
    item(
      'profile',
      !!vendor.displayName && !!vendor.legalName,
      'Add your display name and legal business name'
    ),
    item('address', !!defaultAddress, 'Add a default business address'),
    item(
      'capabilities',
      capabilities.some((capability) => capability.status !== 'rejected'),
      'Choose at least one manufacturing technology'
    ),
    item(
      'agreement',
      hasCurrentAgreement(vendor),
      agreementVersion
        ? vendor.agreementVersion
          ? `Accept the updated vendor agreement (version ${agreementVersion})`
          : `Accept the vendor agreement (version ${agreementVersion})`
        : 'The vendor agreement is not configured yet - contact MakeXYZ'
    ),
    item(
      'tax',
      !!vendor.taxClassification && !!taxDocument && taxDocument.status !== 'rejected',
      taxDocument?.status === 'rejected'
        ? `Your tax form was rejected${taxDocument.rejectedReason ? `: ${taxDocument.rejectedReason}` : ''} - upload a new one`
        : 'Upload your W-9 or W-8 tax form'
    ),
    item(
      'payout_method',
      isPayoutMethodReady(vendor),
      vendor.payoutMethodError
        ? `Reconnect your payout account: ${vendor.payoutMethodError}`
        : 'Connect a payout account (Stripe or PayPal)'
    ),
  ]

  return {
    capabilities,
    taxDocument,
    checklist,
    onboardingComplete: checklist.every((entry) => entry.complete),
  }
}

/**
 * What an admin completes during review. Activation requires this and the
 * vendor's own checklist.
 */
export async function getAdminChecklist(
  vendor: Vendor,
  snapshot: Pick<OnboardingSnapshot, 'capabilities' | 'taxDocument'>
): Promise<ChecklistItem[]> {
  const approved = snapshot.capabilities
    .filter((capability) => capability.status === 'approved')
    .map((capability) => capability.technology)
  const pending = snapshot.capabilities.filter((capability) => capability.status === 'requested')

  // Same rule computePayoutBreakdown applies per order at acceptance, checked
  // up front so an active vendor never trips over a missing rate on their
  // first order.
  let missingRates: string[] = []
  if (approved.length > 0) {
    const [materials, rates] = await Promise.all([
      Material.query().whereIn('technology', approved).orderBy('name', 'asc'),
      VendorPayoutRate.query().where('vendorId', vendor.id),
    ])
    const rated = new Set(rates.map((rate) => rate.materialId))
    missingRates = materials.filter((material) => !rated.has(material.id)).map((m) => m.name)
  }

  return [
    item(
      'capabilities_reviewed',
      approved.length > 0 && pending.length === 0,
      pending.length > 0
        ? `Review requested capabilities: ${pending.map((c) => c.technology).join(', ')}`
        : 'Approve at least one capability'
    ),
    item(
      'tax_verified',
      snapshot.taxDocument?.status === 'verified',
      snapshot.taxDocument ? 'Verify the latest tax form' : 'No tax form uploaded yet'
    ),
    item(
      'payout_rates',
      approved.length > 0 && missingRates.length === 0,
      approved.length === 0
        ? 'Approve a capability first'
        : `Set payout rates for: ${missingRates.join(', ')}`
    ),
  ]
}

async function audit(
  vendor: Vendor,
  userId: number | null,
  action: string,
  details: Record<string, unknown> = {},
  trx?: TransactionClientContract
) {
  await AuditEvent.create(
    {
      entityType: 'vendor',
      entityId: vendor.id,
      eventType: 'updated',
      userId,
      payload: { action, vendorUuid: vendor.uuid, ...details },
    },
    trx ? { client: trx } : {}
  )
}

function assertNotSuspended(vendor: Vendor) {
  if (vendor.status === 'suspended') {
    throw new VendorStatusError('Suspended vendors cannot change their onboarding details')
  }
}

/* ------------------------------------------------------------------------ */
/* Vendor-side steps                                                          */
/* ------------------------------------------------------------------------ */

export async function updateProfile(
  vendor: Vendor,
  input: { displayName?: string; legalName?: string; phone?: string | null }
): Promise<Vendor> {
  assertNotSuspended(vendor)
  vendor.merge(input)
  await vendor.save()
  return vendor
}

/**
 * Replaces the vendor's declared technologies with `technologies`:
 * - new ones, and previously rejected ones listed again, become 'requested'
 * - already requested/approved ones are left as they are
 * - ones not listed are removed (the vendor no longer offers them)
 */
export async function setCapabilities(vendor: Vendor, technologies: Technology[]): Promise<void> {
  assertNotSuspended(vendor)
  const wanted = new Set(technologies)

  await db.transaction(async (trx) => {
    const existing = await VendorTechnologyCapability.query({ client: trx }).where(
      'vendorId',
      vendor.id
    )
    const byTechnology = new Map(existing.map((capability) => [capability.technology, capability]))

    for (const capability of existing) {
      if (!wanted.has(capability.technology)) {
        await capability.useTransaction(trx).delete()
      }
    }

    for (const technology of wanted) {
      const capability = byTechnology.get(technology)
      if (!capability) {
        await VendorTechnologyCapability.create(
          { vendorId: vendor.id, technology, status: 'requested', isPreferred: false },
          { client: trx }
        )
      } else if (capability.status === 'rejected') {
        capability.merge({
          status: 'requested',
          isPreferred: false,
          reviewedAt: null,
          reviewedById: null,
        })
        await capability.useTransaction(trx).save()
      }
    }
  })
}

/**
 * Records acceptance of the agreement version currently in force. `ip` must
 * come from request.ip() (proxy-aware via config/app.ts trustProxy), never a
 * raw X-Forwarded-For entry.
 */
export async function acceptAgreement(
  vendor: Vendor,
  version: string,
  ip: string
): Promise<Vendor> {
  const current = currentAgreementVersion()
  if (!current) {
    throw new AgreementVersionError('The vendor agreement is not configured yet')
  }
  if (version !== current) {
    throw new AgreementVersionError(
      `Agreement version ${version} is not current - the current version is ${current}`
    )
  }

  vendor.merge({
    agreementVersion: current,
    agreementAcceptedAt: DateTime.now(),
    agreementAcceptedIp: ip,
  })
  await vendor.save()
  await audit(vendor, vendor.userId, 'agreement_accepted', { version: current, ip })
  return vendor
}

/**
 * Stores a new W-9/W-8 as the vendor's current tax document. Every upload is
 * a new row - earlier ones stay as history, and the latest is the current one.
 */
export async function uploadTaxDocument(
  vendor: Vendor,
  input: { taxClassification: TaxClassification; formType: TaxFormType; file: MultipartFile }
): Promise<VendorTaxDocument> {
  const documentUuid = string.uuid()
  const storageKey = `${env.get('S3_FILE_STORAGE_KEY')}/vendors/${vendor.uuid}/tax/${documentUuid}.pdf`
  await input.file.moveToDisk(storageKey)

  return db.transaction(async (trx) => {
    vendor.taxClassification = input.taxClassification
    await vendor.useTransaction(trx).save()

    return VendorTaxDocument.create(
      {
        uuid: documentUuid,
        vendorId: vendor.id,
        formType: input.formType,
        storageKey,
        originalName: input.file.clientName,
      },
      { client: trx }
    )
  })
}

/** onboarding -> pending_review, once the vendor's own checklist is complete. */
export async function submitForReview(vendor: Vendor): Promise<Vendor> {
  if (vendor.status !== 'onboarding') {
    throw new VendorStatusError(
      `Only onboarding vendors can submit for review (status: ${vendor.status})`
    )
  }

  const snapshot = await getOnboardingSnapshot(vendor)
  if (!snapshot.onboardingComplete) {
    throw new ChecklistIncompleteError(
      'Complete every onboarding step before submitting',
      snapshot.checklist
    )
  }

  vendor.merge({ status: 'pending_review', submittedAt: DateTime.now() })
  await vendor.save()
  await audit(vendor, vendor.userId, 'submitted_for_review')

  // TODO(mail): notify admins that vendor <displayName> (<vendor.uuid>) is ready
  // for review, linking to the admin vendor page.

  return vendor
}

/* ------------------------------------------------------------------------ */
/* Admin review                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Approves or rejects a capability the vendor requested. `isPreferred` only
 * sticks on an approved capability - a rejected one can never be preferred.
 */
export async function reviewCapability(
  vendor: Vendor,
  technology: Technology,
  decision: { status: 'approved' | 'rejected'; isPreferred?: boolean },
  adminUserId: number
): Promise<VendorTechnologyCapability> {
  const capability = await VendorTechnologyCapability.query()
    .where('vendorId', vendor.id)
    .where('technology', technology)
    .first()
  if (!capability) {
    throw new CapabilityNotRequestedError(`Vendor ${vendor.uuid} has not requested ${technology}`)
  }

  capability.merge({
    status: decision.status,
    isPreferred:
      decision.status === 'approved' ? (decision.isPreferred ?? capability.isPreferred) : false,
    reviewedAt: DateTime.now(),
    reviewedById: adminUserId,
  })
  await capability.save()
  await audit(vendor, adminUserId, `capability_${decision.status}`, {
    technology,
    isPreferred: capability.isPreferred,
  })

  if (decision.status === 'rejected') {
    // TODO(mail): tell the vendor their <technology> capability was not
    // approved, and that they can contact MakeXYZ or request it again.
  }

  return capability
}

async function currentUnreviewedTaxDocument(vendor: Vendor): Promise<VendorTaxDocument> {
  const document = await latestTaxDocument(vendor.id)
  if (!document) {
    throw new TaxDocumentNotFoundError(`Vendor ${vendor.uuid} has no tax document`)
  }
  if (document.status !== 'uploaded') {
    throw new TaxDocumentAlreadyReviewedError(
      `The current tax document is already ${document.status}`
    )
  }
  return document
}

export async function verifyTaxDocument(
  vendor: Vendor,
  adminUserId: number
): Promise<VendorTaxDocument> {
  const document = await currentUnreviewedTaxDocument(vendor)
  document.merge({ verifiedAt: DateTime.now(), verifiedById: adminUserId })
  await document.save()
  await audit(vendor, adminUserId, 'tax_document_verified', { documentUuid: document.uuid })
  return document
}

export async function rejectTaxDocument(
  vendor: Vendor,
  reason: string,
  adminUserId: number
): Promise<VendorTaxDocument> {
  const document = await currentUnreviewedTaxDocument(vendor)
  document.merge({ rejectedAt: DateTime.now(), rejectedReason: reason })
  await document.save()
  await audit(vendor, adminUserId, 'tax_document_rejected', { documentUuid: document.uuid, reason })

  // TODO(mail): tell the vendor their tax form was rejected, with `reason`, and
  // ask them to upload a corrected one.

  return document
}

/** pending_review -> active, once both checklists are complete. */
export async function activateVendor(vendor: Vendor, adminUserId: number): Promise<Vendor> {
  if (vendor.status !== 'pending_review') {
    throw new VendorStatusError(
      `Only vendors pending review can be activated (status: ${vendor.status})`
    )
  }

  const snapshot = await getOnboardingSnapshot(vendor)
  const adminChecklist = await getAdminChecklist(vendor, snapshot)
  if (!snapshot.onboardingComplete || !adminChecklist.every((entry) => entry.complete)) {
    throw new ChecklistIncompleteError(
      'Every onboarding and review item must be complete before activation',
      snapshot.checklist,
      adminChecklist
    )
  }

  vendor.merge({
    status: 'active',
    activatedAt: DateTime.now(),
    activatedById: adminUserId,
    suspendedAt: null,
    suspensionReason: null,
  })
  await vendor.save()
  await audit(vendor, adminUserId, 'activated')

  // TODO(mail): "you're live" email to the vendor - they can now see and accept
  // orders for their approved technologies.

  return vendor
}

/**
 * active -> suspended. A suspended vendor can't accept new orders or count for
 * routing, but can still finish orders already accepted - see
 * docs/VENDOR_ONBOARDING.md.
 */
export async function suspendVendor(
  vendor: Vendor,
  reason: string,
  adminUserId: number
): Promise<Vendor> {
  if (vendor.status !== 'active') {
    throw new VendorStatusError(`Only active vendors can be suspended (status: ${vendor.status})`)
  }

  vendor.merge({ status: 'suspended', suspendedAt: DateTime.now(), suspensionReason: reason })
  await vendor.save()
  await audit(vendor, adminUserId, 'suspended', { reason })

  // TODO(mail): tell the vendor they've been suspended, with `reason`, and that
  // orders they've already accepted should still be completed.

  return vendor
}

/** suspended -> active. */
export async function reinstateVendor(vendor: Vendor, adminUserId: number): Promise<Vendor> {
  if (vendor.status !== 'suspended') {
    throw new VendorStatusError(
      `Only suspended vendors can be reinstated (status: ${vendor.status})`
    )
  }

  vendor.merge({ status: 'active', suspendedAt: null, suspensionReason: null })
  await vendor.save()
  await audit(vendor, adminUserId, 'reinstated')

  // TODO(mail): tell the vendor they've been reinstated and can accept orders again.

  return vendor
}
