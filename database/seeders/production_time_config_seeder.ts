import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { DateTime } from 'luxon'
import ProductionTimeConfig from '#models/production_time_config'

/**
 * Seeds the initial production-time configuration. Same status as
 * pricing_config_seeder.ts's FDM defaults: these are the CURRENT default
 * values, not permanent constants, and specifically baseFee/growthRate here
 * are illustrative placeholders - the plan this implements explicitly calls
 * out that real numbers need business sign-off before launch. Changing them
 * later means creating a new version and activating it, not editing this
 * seeder, so historical quotes keep pointing at the configuration that priced
 * them.
 *
 * standardBusinessDays=5 is the reference point the exponential formula
 * measures "days saved" from (fee(daysSaved) = baseFee * (growthRate^daysSaved
 * - 1)). Tiers include 5 itself (fee 0, since daysSaved works out to 0) - see
 * production_time_service.ts.
 */
export default class extends BaseSeeder {
  async run() {
    const existing = await ProductionTimeConfig.query().where('version', 1).first()
    if (existing) {
      return
    }

    const config = await ProductionTimeConfig.create({
      name: 'Production time default',
      version: 1,
      isActive: true,
      standardBusinessDays: 5,
      baseFee: '5.00',
      growthRate: '1.6',
      notes: 'Initial production-time constants - placeholder, needs business sign-off.',
      activatedAt: DateTime.now(),
    })

    await config.related('tiers').createMany([
      { businessDays: 5 },
      { businessDays: 3 },
      { businessDays: 2 },
      { businessDays: 1 },
    ])
  }
}
