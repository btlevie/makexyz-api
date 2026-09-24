import env from '#start/env'

/**
 * MakeXYZ's own origin, used as both the from and the return address on every
 * instant-quote shipping label. Vendors fulfilling instant-quote orders ship
 * on MakeXYZ's EasyPost account under MakeXYZ's name - never their own
 * address (see shipment_service.ts). Orders outside the instant quote aren't
 * eligible for these labels at all.
 */
export type ShipFromAddress = {
  name: string
  company: string | null
  street1: string
  street2: string | null
  city: string
  state: string
  zip: string
  country: string
  phone: string
  email: string | null
}

export function makexyzShipFromAddress(): ShipFromAddress {
  return {
    name: env.get('MAKEXYZ_SHIP_FROM_NAME') ?? '',
    company: env.get('MAKEXYZ_SHIP_FROM_COMPANY') ?? null,
    street1: env.get('MAKEXYZ_SHIP_FROM_LINE1') ?? '',
    street2: env.get('MAKEXYZ_SHIP_FROM_LINE2') ?? null,
    city: env.get('MAKEXYZ_SHIP_FROM_CITY') ?? '',
    state: env.get('MAKEXYZ_SHIP_FROM_STATE') ?? '',
    zip: env.get('MAKEXYZ_SHIP_FROM_POSTAL_CODE') ?? '',
    country: env.get('MAKEXYZ_SHIP_FROM_COUNTRY') ?? 'US',
    phone: env.get('MAKEXYZ_SHIP_FROM_PHONE') ?? '',
    email: env.get('MAKEXYZ_SHIP_FROM_EMAIL') ?? null,
  }
}

const shippingConfig = { makexyzShipFromAddress }
export default shippingConfig
