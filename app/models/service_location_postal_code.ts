import { ServiceLocationPostalCodeSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ServiceLocation from '#models/service_location'

/** A postal code inside a city page's city. */
export default class ServiceLocationPostalCode extends ServiceLocationPostalCodeSchema {
  @belongsTo(() => ServiceLocation)
  declare serviceLocation: BelongsTo<typeof ServiceLocation>
}
