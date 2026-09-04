import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { DateTime } from 'luxon'
import PricingConfig from '#models/pricing_config'

/**
 * Seeds the initial FDM pricing configuration.
 *
 * These are the CURRENT default values, not permanent constants - the whole
 * point of holding them in the database is that an administrator can tune them
 * without a deploy. Changing pricing should mean creating a new version and
 * activating it (see PricingConfigService.activateConfig), not editing this
 * seeder, so historical quotes keep pointing at the configuration that produced
 * them.
 */
export default class extends BaseSeeder {
  async run() {
    const existing = await PricingConfig.query()
      .where('technology', 'fdm')
      .where('version', 1)
      .first()

    if (existing) {
      return
    }

    const config = await PricingConfig.create({
      technology: 'fdm',
      name: 'FDM default pricing',
      version: 1,
      isActive: true,
      notes: 'Initial FDM pricing constants.',
      activatedAt: DateTime.now(),
    })

    await config.related('fdmValues').create({
      modelMaterialRatePerGram: '0.15',
      supportMaterialRatePerGram: '0.30',
      machineRatePerHour: '2.00',
      failureBufferMultiplier: '1.10',
      fixedLineItemCharge: '7.50',
      bulkFloorSmallMultiplier: '7.00',
      bulkFloorLargeMultiplier: '3.25',
      bulkFloorBreakGrams: '75.00',
      bulkFloorSigmoidWidthGrams: '15.00',
      quantityDecayConstant: '18.00',
      oversizeThresholdMm: '325.00',
      oversizeMultiplier: '1.30',
    })
  }
}
