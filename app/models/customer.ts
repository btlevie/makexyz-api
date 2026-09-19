import { CustomerSchema } from '#database/schema'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Address from '#models/address'

export default class Customer extends CustomerSchema {
  @hasMany(() => Address)
  declare addresses: HasMany<typeof Address>
}
