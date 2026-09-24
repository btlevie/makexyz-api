import string from '@adonisjs/core/helpers/string'
import Material from '#models/material'
import MaterialColor from '#models/material_color'
import type Order from '#models/order'
import OrderItem from '#models/order_item'
import ProjectFile from '#models/project_file'
import type Vendor from '#models/vendor'
import VendorPayoutRate from '#models/vendor_payout_rate'
import { fakeStripeConnectClient } from '#services/stripe_connect_service'

/**
 * A vendor with a ready payout method, as if they'd finished onboarding.
 * Accepting an order requires one (see vendor_payout_method_service.ts).
 */
export async function makePayoutReady(
  vendor: Vendor,
  provider: 'stripe' | 'paypal' = 'stripe'
): Promise<Vendor> {
  if (provider === 'stripe') {
    // Registered with the fake Connect client - every transfer re-reads the
    // account's payouts_enabled first.
    const { accountId } = await fakeStripeConnectClient.createExpressAccount({
      email: null,
      vendorUuid: vendor.uuid,
    })
    fakeStripeConnectClient.setPayoutsEnabled(accountId, true)
    vendor.merge({
      payoutProvider: 'stripe',
      stripeAccountId: accountId,
      stripePayoutsEnabled: true,
    })
  } else {
    vendor.merge({
      payoutProvider: 'paypal',
      paypalPayerId: `PAYER${string.random(10).toUpperCase()}`,
      paypalEmail: 'vendor@paypal.test',
    })
  }
  await vendor.save()
  return vendor
}

export async function createMaterial(
  name: string,
  technology: 'fdm' | 'sla' | 'sls' = 'fdm'
): Promise<Material> {
  const material = await Material.create({
    uuid: string.uuid(),
    name,
    technology,
    isDefault: false,
  })
  // Material changes resolve a default color, so every test material has one.
  await MaterialColor.create({
    uuid: string.uuid(),
    materialId: material.id,
    name: 'Black',
    hex: '#000000',
    isDefault: true,
  })
  return material
}

export async function setPayoutRate(
  vendor: Vendor,
  material: Material,
  percentage: string
): Promise<VendorPayoutRate> {
  return VendorPayoutRate.updateOrCreate(
    { vendorId: vendor.id, materialId: material.id },
    { percentage }
  )
}

/**
 * Gives every material-less part on the order a material (one per
 * technology) and the vendor a rate for each - everything acceptOrder needs
 * beyond a ready payout method.
 */
export async function prepareOrderForPayout(
  order: Order,
  vendor: Vendor,
  percentage = '70.00'
): Promise<void> {
  const items = await OrderItem.query().where('orderId', order.id)
  const materialsByTechnology = new Map<string, Material>()

  for (const item of items) {
    if (!item.projectFileId) continue
    const projectFile = await ProjectFile.findOrFail(item.projectFileId)
    if (!projectFile.materialId) {
      const technology = projectFile.technology ?? 'fdm'
      let material = materialsByTechnology.get(technology)
      if (!material) {
        material = await createMaterial(`Test ${technology} ${string.random(4)}`, technology)
        materialsByTechnology.set(technology, material)
      }
      projectFile.materialId = material.id
      await projectFile.save()
    }
    const material = await Material.findOrFail(projectFile.materialId)
    await setPayoutRate(vendor, material, percentage)
  }
}

/** Both of the above - a vendor that can accept `order`. */
export async function readyVendorForOrder(order: Order, vendor: Vendor): Promise<void> {
  await makePayoutReady(vendor)
  await prepareOrderForPayout(order, vendor)
}
