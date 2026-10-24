/**
 * Every moderation rule, in evaluation order. Adding a rule is a new file in
 * this folder plus one line here - nothing else changes. Whether a rule is
 * off, shadow or enforce (and its thresholds) is runtime config in
 * moderation_rule_configs (admin endpoints), not code; `defaultMode` is only
 * the starting point.
 *
 * Launch posture (docs/plans/messaging_moderation.md, Step 2): only the
 * near-certain rules enforce - contact details, crypto/bank details, the
 * link-safety rules (Step 3: unknown links are held for automated analysis,
 * malicious ones blocked), attachment scanning, and unambiguous prohibited
 * items. Everything else runs in shadow until live data shows it's precise
 * enough to promote.
 */
import type { ModerationRule } from '#services/moderation/types'
import abuseHarassmentCandidate from '#services/moderation/rules/abuse_harassment_candidate'
import abuseThreatLexicon from '#services/moderation/rules/abuse_threat_lexicon'
import attachmentPending from '#services/moderation/rules/attachment_pending'
import attachmentRejected from '#services/moderation/rules/attachment_rejected'
import attachmentUnverified from '#services/moderation/rules/attachment_unverified'
import adPromoLanguage from '#services/moderation/rules/ad_promo_language'
import adUnrelatedUrl from '#services/moderation/rules/ad_unrelated_url'
import contactEmail from '#services/moderation/rules/contact_email'
import contactObfuscationAttempt from '#services/moderation/rules/contact_obfuscation_attempt'
import contactPhone from '#services/moderation/rules/contact_phone'
import contactPhoneDigits from '#services/moderation/rules/contact_phone_digits'
import contactPlatformHandle from '#services/moderation/rules/contact_platform_handle'
import contactSolicitation from '#services/moderation/rules/contact_solicitation'
import contextOffTopicCommercial from '#services/moderation/rules/context_off_topic_commercial'
import contextPostFulfilment from '#services/moderation/rules/context_post_fulfilment'
import inquiryColdPitch from '#services/moderation/rules/inquiry_cold_pitch'
import llmInjectionText from '#services/moderation/rules/llm_injection_text'
import paymentBankDetails from '#services/moderation/rules/payment_bank_details'
import paymentCryptoAddress from '#services/moderation/rules/payment_crypto_address'
import paymentDirectIntent from '#services/moderation/rules/payment_direct_intent'
import paymentFeeAvoidance from '#services/moderation/rules/payment_fee_avoidance'
import paymentOffplatformMethod from '#services/moderation/rules/payment_offplatform_method'
import paymentQuotePhaseDirect from '#services/moderation/rules/payment_quote_phase_direct'
import profanityGeneral from '#services/moderation/rules/profanity_general'
import prohibitedCounterfeitFraud from '#services/moderation/rules/prohibited_counterfeit_fraud'
import prohibitedDrugs from '#services/moderation/rules/prohibited_drugs'
import prohibitedFirearm from '#services/moderation/rules/prohibited_firearm'
import prohibitedWeapon from '#services/moderation/rules/prohibited_weapon'
import spamDuplicateCrossConversation from '#services/moderation/rules/spam_duplicate_cross_conversation'
import urlDangerousFile from '#services/moderation/rules/url_dangerous_file'
import urlIpLiteral from '#services/moderation/rules/url_ip_literal'
import urlReputationUnknown from '#services/moderation/rules/url_reputation_unknown'
import urlSuspiciousShape from '#services/moderation/rules/url_suspicious_shape'
import urlUnsafe from '#services/moderation/rules/url_unsafe'
import urlUnverified from '#services/moderation/rules/url_unverified'
import urlUserContentFromVendor from '#services/moderation/rules/url_user_content_from_vendor'
import urlYoungDomain from '#services/moderation/rules/url_young_domain'

export const RULES: ModerationRule<any>[] = [
  // Contact details and moving off-platform
  contactEmail,
  contactPhone,
  contactPhoneDigits,
  contactPlatformHandle,
  contactSolicitation,
  contactObfuscationAttempt,
  // Payments outside MakeXYZ
  paymentCryptoAddress,
  paymentBankDetails,
  paymentOffplatformMethod,
  paymentDirectIntent,
  paymentFeeAvoidance,
  paymentQuotePhaseDirect,
  // Prohibited items
  prohibitedFirearm,
  prohibitedWeapon,
  prohibitedDrugs,
  prohibitedCounterfeitFraud,
  // Links
  urlUnsafe,
  urlDangerousFile,
  urlUnverified,
  urlReputationUnknown,
  urlYoungDomain,
  urlUserContentFromVendor,
  urlIpLiteral,
  urlSuspiciousShape,
  // Attachments
  attachmentRejected,
  attachmentPending,
  attachmentUnverified,
  // Advertising and spam
  adPromoLanguage,
  adUnrelatedUrl,
  spamDuplicateCrossConversation,
  inquiryColdPitch,
  contextPostFulfilment,
  contextOffTopicCommercial,
  // Abuse and the rest
  abuseThreatLexicon,
  abuseHarassmentCandidate,
  profanityGeneral,
  llmInjectionText,
]
