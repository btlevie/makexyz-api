import type { ModerationRule } from '#services/moderation/types'

/**
 * Bank details: a checksum-valid IBAN, or a valid routing number / SWIFT code
 * next to banking words. Payment outside MakeXYZ.
 */
const paymentBankDetails: ModerationRule = {
  id: 'payment.bank_details',
  version: 1,
  description: 'IBANs, routing numbers and SWIFT/BIC codes',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const details = ctx.signals.bankDetails
    return details.length > 0
      ? {
          action: 'block',
          reasonCode: 'payment.bank_details',
          evidence: details.map((detail) => ({ view: 'raw' as const, match: detail.value })),
          userMessage:
            "Sharing payment details isn't allowed on MakeXYZ - all payments go through MakeXYZ checkout.",
        }
      : null
  },
}

export default paymentBankDetails
