import type { HttpContext } from '@adonisjs/core/http'
import { resolveVendor } from '#services/vendor_onboarding_service'
import Address from '#models/address'
import AddressTransformer from '#transformers/address_transformer'
import { createAddressValidator, updateAddressValidator } from '#validators/address'
import { createAddress, updateAddress, deleteAddress, AddressInUseError } from '#services/address_service'

export default class VendorAddressesController {
  async index(ctx: HttpContext) {
    const { response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const addresses = await Address.query()
      .where('vendorId', vendor.id)
      .where('ownerType', 'vendor')
      .orderBy('createdAt', 'desc')
    return await serialize(AddressTransformer.transform(addresses))
  }

  async store(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const input = await request.validateUsing(createAddressValidator)
    const address = await createAddress({ ownerType: 'vendor', vendorId: vendor.id, ...input })
    return await serialize(AddressTransformer.transform(address))
  }

  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const address = await this.findOwnAddress(vendor.id, params.uuid)
    if (!address) {
      return response.notFound({ error: 'Address not found' })
    }
    return await serialize(AddressTransformer.transform(address))
  }

  async update(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const address = await this.findOwnAddress(vendor.id, params.uuid)
    if (!address) {
      return response.notFound({ error: 'Address not found' })
    }

    const input = await request.validateUsing(updateAddressValidator)
    try {
      const updated = await updateAddress(address, input)
      return await serialize(AddressTransformer.transform(updated))
    } catch (error) {
      if (error instanceof AddressInUseError) {
        return response.conflict({ error: error.message })
      }
      throw error
    }
  }

  async destroy(ctx: HttpContext) {
    const { params, response } = ctx
    const vendor = await resolveVendor(ctx)
    if (!vendor) {
      return response.forbidden({ error: 'No vendor record for this account' })
    }

    const address = await this.findOwnAddress(vendor.id, params.uuid)
    if (!address) {
      return response.notFound({ error: 'Address not found' })
    }

    try {
      await deleteAddress(address)
      return response.noContent()
    } catch (error) {
      if (error instanceof AddressInUseError) {
        return response.conflict({ error: error.message })
      }
      throw error
    }
  }

  private findOwnAddress(vendorId: number, uuid: string) {
    return Address.query()
      .where('uuid', uuid)
      .where('vendorId', vendorId)
      .where('ownerType', 'vendor')
      .first()
  }
}
