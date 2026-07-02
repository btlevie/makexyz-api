import { BaseTransformer } from '@adonisjs/core/transformers'
import Customer from '#models/customer'

export default class CustomerTransformer extends BaseTransformer<Customer> {
  toObject() {
    return this.pick(this.resource, ['id', 'firstName', 'lastName'])
  }
}