import { BaseTransformer } from '@adonisjs/core/transformers'
import type Vendor from '#models/vendor'
import {
  currentAgreementVersion,
  getOnboardingSnapshot,
  type OnboardingSnapshot,
} from '#services/vendor_onboarding_service'

/**
 * The onboarding payload shared by the vendor's own view and the admin view
 * (admin_vendor_transformer.ts adds to it). Storage keys and payout account
 * ids are never exposed.
 */
export function onboardingPayload(vendor: Vendor, snapshot: OnboardingSnapshot) {
  const taxDocument = snapshot.taxDocument
  return {
    uuid: vendor.uuid,
    status: vendor.status,
    displayName: vendor.displayName,
    legalName: vendor.legalName,
    phone: vendor.phone,
    taxClassification: vendor.taxClassification,
    submittedAt: vendor.submittedAt,
    activatedAt: vendor.activatedAt,
    suspendedAt: vendor.suspendedAt,
    suspensionReason: vendor.suspensionReason,
    agreement: {
      currentVersion: currentAgreementVersion(),
      acceptedVersion: vendor.agreementVersion,
      acceptedAt: vendor.agreementAcceptedAt,
    },
    capabilities: snapshot.capabilities.map((capability) => ({
      technology: capability.technology,
      status: capability.status,
      isPreferred: capability.isPreferred,
      reviewedAt: capability.reviewedAt,
    })),
    taxDocument: taxDocument
      ? {
          uuid: taxDocument.uuid,
          formType: taxDocument.formType,
          originalName: taxDocument.originalName,
          status: taxDocument.status,
          rejectedReason: taxDocument.rejectedReason,
          createdAt: taxDocument.createdAt,
        }
      : null,
    checklist: snapshot.checklist,
    onboardingComplete: snapshot.onboardingComplete,
  }
}

/** The vendor's own onboarding status and checklist - see docs/VENDOR_ONBOARDING.md. */
export default class VendorOnboardingTransformer extends BaseTransformer<Vendor> {
  async toObject() {
    return onboardingPayload(this.resource, await getOnboardingSnapshot(this.resource))
  }
}
