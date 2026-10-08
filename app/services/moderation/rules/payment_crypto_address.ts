import type { ModerationRule } from '#services/moderation/types'

/** A checksum-valid crypto address (BTC, ETH, Tron) - payment outside MakeXYZ. */
const paymentCryptoAddress: ModerationRule = {
  id: 'payment.crypto_address',
  version: 1,
  description: 'Checksum-valid cryptocurrency wallet addresses',
  defaultMode: 'enforce',
  defaultConfig: {},
  evaluate(ctx) {
    const addresses = ctx.signals.cryptoAddresses
    return addresses.length > 0
      ? {
          action: 'block',
          reasonCode: 'payment.crypto_address',
          evidence: addresses.map((address) => ({ view: 'raw' as const, match: address.address })),
          userMessage:
            "Sharing payment details isn't allowed on MakeXYZ - all payments go through MakeXYZ checkout.",
        }
      : null
  },
}

export default paymentCryptoAddress
