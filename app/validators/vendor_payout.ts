import vine from '@vinejs/vine'

/** The frontend relays PayPal's redirect query params here after Log in with PayPal. */
export const paypalConnectCallbackValidator = vine.create({
  code: vine.string().trim().minLength(1).maxLength(2048),
  state: vine.string().trim().minLength(1).maxLength(4096),
})

/** Optional reduced amount (dollars) when releasing a held payout. */
export const releasePayoutValidator = vine.create({
  amount: vine.number().positive().decimal([0, 2]).optional(),
})

/** Upserts a vendor's per-material payout rates. */
export const payoutRatesValidator = vine.create({
  rates: vine
    .array(
      vine.object({
        materialUuid: vine.string().trim().uuid(),
        percentage: vine.number().min(0).max(100).decimal([0, 2]),
      })
    )
    .minLength(1),
})

export const updateVendorPayoutSettingsValidator = vine.create({
  /** null resets the vendor to the default hold period. */
  payoutHoldDays: vine.number().withoutDecimals().min(0).max(90).nullable(),
})

export const PAYOUT_STATUSES = [
  'pending',
  'held',
  'processing',
  'paid',
  'failed',
  'cancelled',
] as const
