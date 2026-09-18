import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { DateTime } from 'luxon'
import OrderRoutingConfig from '#models/order_routing_config'

/**
 * Seeds the initial order-routing configuration. Same status as
 * pricing_config_seeder.ts/production_time_config_seeder.ts's defaults: the
 * CURRENT default, not a permanent constant - 24h is what was specified, but
 * changing it later means creating a new version and activating it, not
 * editing this seeder.
 */
export default class extends BaseSeeder {
  async run() {
    const existing = await OrderRoutingConfig.query().where('version', 1).first()
    if (existing) {
      return
    }

    await OrderRoutingConfig.create({
      name: 'Order routing default',
      version: 1,
      isActive: true,
      preferredWindowHours: 24,
      notes: 'Initial preferred-vendor window.',
      activatedAt: DateTime.now(),
    })
  }
}
