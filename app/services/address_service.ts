/**
 * Address book mutations shared by the customer/vendor CRUD endpoints
 * (addresses_controller.ts / vendor_addresses_controller.ts) and quote
 * configuration's inline-creation path (quote_generation_service.ts) - one
 * place owns "only one default per owner" and the guest-checkout default
 * label, instead of three copies of the same logic.
 */
import db from '@adonisjs/lucid/services/db'
import string from '@adonisjs/core/helpers/string'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Address from '#models/address'
import Order from '#models/order'
import Quote from '#models/quote'
import Shipment from '#models/shipment'

/** Fallback label for an address created without one (e.g. guest checkout). */
export const DEFAULT_ADDRESS_LABEL = 'Shipping Address'

export type AddressInput = {
  ownerType: 'customer' | 'vendor'
  customerId?: number | null
  vendorId?: number | null
  label?: string | null
  recipientName: string
  line1: string
  line2?: string | null
  city: string
  state?: string | null
  postalCode: string
  country: string
  isDefault?: boolean
}

/**
 * Unsets any existing default for the same owner before a new one is set -
 * a no-op when the owner isn't known yet (an anonymous instant-quote guest
 * has no customerId to scope "only one default" against).
 */
async function unsetExistingDefault(
  owner: Pick<AddressInput, 'ownerType' | 'customerId' | 'vendorId'>,
  trx: TransactionClientContract
): Promise<void> {
  if (owner.ownerType === 'customer') {
    if (!owner.customerId) return
    await Address.query({ client: trx })
      .where('customerId', owner.customerId)
      .where('ownerType', 'customer')
      .update({ is_default: false })
  } else {
    if (!owner.vendorId) return
    await Address.query({ client: trx })
      .where('vendorId', owner.vendorId)
      .where('ownerType', 'vendor')
      .update({ is_default: false })
  }
}

export async function createAddress(
  input: AddressInput,
  trx?: TransactionClientContract
): Promise<Address> {
  const run = async (t: TransactionClientContract) => {
    if (input.isDefault) {
      await unsetExistingDefault(input, t)
    }
    return Address.create(
      {
        uuid: string.uuid(),
        ownerType: input.ownerType,
        customerId: input.customerId ?? null,
        vendorId: input.vendorId ?? null,
        label: input.label ?? DEFAULT_ADDRESS_LABEL,
        recipientName: input.recipientName,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        state: input.state ?? null,
        postalCode: input.postalCode,
        country: input.country,
        isDefault: input.isDefault ?? false,
      },
      { client: t }
    )
  }

  return trx ? run(trx) : db.transaction(run)
}

export async function updateAddress(
  address: Address,
  input: Partial<Omit<AddressInput, 'ownerType' | 'customerId' | 'vendorId'>>
): Promise<Address> {
  return db.transaction(async (trx) => {
    if (input.isDefault) {
      await unsetExistingDefault(
        { ownerType: address.ownerType, customerId: address.customerId, vendorId: address.vendorId },
        trx
      )
    }

    address.useTransaction(trx)
    if (input.label !== undefined) address.label = input.label ?? null
    if (input.recipientName !== undefined) address.recipientName = input.recipientName
    if (input.line1 !== undefined) address.line1 = input.line1
    if (input.line2 !== undefined) address.line2 = input.line2 ?? null
    if (input.city !== undefined) address.city = input.city
    if (input.state !== undefined) address.state = input.state ?? null
    if (input.postalCode !== undefined) address.postalCode = input.postalCode
    if (input.country !== undefined) address.country = input.country
    if (input.isDefault !== undefined) address.isDefault = input.isDefault
    await address.save()

    return address
  })
}

export class AddressInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AddressInUseError'
  }
}

/**
 * Refuses to delete an address a quote, order, or shipment still points to -
 * onDelete intentionally isn't SET NULL on any of those FKs (see the
 * migrations), so this check is the actual enforcement, not a backstop.
 * Shipments can't exist yet (no service creates them), but the column
 * already exists on the schema, so checking it now costs nothing and needs
 * no revisiting once that feature lands.
 */
export async function deleteAddress(address: Address): Promise<void> {
  // Alias deliberately isn't "total" - both Quote and Order already have a
  // real `total` column (the price), and Lucid resolves a computed value
  // into an existing column name instead of $extras, silently breaking this
  // check.
  const [quoteCount, orderCount, shipmentCount] = await Promise.all([
    Quote.query().where('addressId', address.id).count('* as address_ref_count'),
    Order.query().where('addressId', address.id).count('* as address_ref_count'),
    Shipment.query().where('addressId', address.id).count('* as address_ref_count'),
  ])
  const inUse = [quoteCount, orderCount, shipmentCount].some(
    (rows) => Number(rows[0].$extras.address_ref_count) > 0
  )
  if (inUse) {
    throw new AddressInUseError(
      `Address ${address.uuid} is referenced by an existing quote, order, or shipment and cannot be deleted`
    )
  }

  await address.delete()
}
