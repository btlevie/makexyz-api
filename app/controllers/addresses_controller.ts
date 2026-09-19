import type { HttpContext } from '@adonisjs/core/http'
import Address from '#models/address'
import Customer from '#models/customer'
import AddressTransformer from '#transformers/address_transformer'
import { createAddressValidator, updateAddressValidator } from '#validators/address'
import { createAddress, updateAddress, deleteAddress, AddressInUseError } from '#services/address_service'

export default class AddressesController {
  /** Resolves the calling user's Customer record, or null if they have none. */
  private async resolveCustomer(ctx: HttpContext): Promise<Customer | null> {
    const user = ctx.auth.getUserOrFail()
    return Customer.findBy('userId', user.id)
  }

  async index(ctx: HttpContext) {
    const { response, serialize } = ctx
    const customer = await this.resolveCustomer(ctx)
    if (!customer) {
      return response.notFound({ error: 'No customer profile for this account' })
    }

    const addresses = await Address.query()
      .where('customerId', customer.id)
      .where('ownerType', 'customer')
      .orderBy('createdAt', 'desc')
    return await serialize(AddressTransformer.transform(addresses))
  }

  async store(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    const customer = await this.resolveCustomer(ctx)
    if (!customer) {
      return response.notFound({ error: 'No customer profile for this account' })
    }

    const input = await request.validateUsing(createAddressValidator)
    const address = await createAddress({ ownerType: 'customer', customerId: customer.id, ...input })
    return await serialize(AddressTransformer.transform(address))
  }

  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    const customer = await this.resolveCustomer(ctx)
    if (!customer) {
      return response.notFound({ error: 'No customer profile for this account' })
    }

    const address = await this.findOwnAddress(customer.id, params.uuid)
    if (!address) {
      return response.notFound({ error: 'Address not found' })
    }
    return await serialize(AddressTransformer.transform(address))
  }

  async update(ctx: HttpContext) {
    const { params, request, response, serialize } = ctx
    const customer = await this.resolveCustomer(ctx)
    if (!customer) {
      return response.notFound({ error: 'No customer profile for this account' })
    }

    const address = await this.findOwnAddress(customer.id, params.uuid)
    if (!address) {
      return response.notFound({ error: 'Address not found' })
    }

    const input = await request.validateUsing(updateAddressValidator)
    const updated = await updateAddress(address, input)
    return await serialize(AddressTransformer.transform(updated))
  }

  async destroy(ctx: HttpContext) {
    const { params, response } = ctx
    const customer = await this.resolveCustomer(ctx)
    if (!customer) {
      return response.notFound({ error: 'No customer profile for this account' })
    }

    const address = await this.findOwnAddress(customer.id, params.uuid)
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

  private findOwnAddress(customerId: number, uuid: string) {
    return Address.query()
      .where('uuid', uuid)
      .where('customerId', customerId)
      .where('ownerType', 'customer')
      .first()
  }
}
