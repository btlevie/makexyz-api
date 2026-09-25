import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import CheckoutSession from '#models/checkout_session'
import Customer from '#models/customer'
import Order from '#models/order'
import Payment from '#models/payment'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Quote from '#models/quote'
import User from '#models/user'
import Vendor from '#models/vendor'
import { activeVendorAttributes } from '#tests/helpers/vendors'
import VendorPayout from '#models/vendor_payout'
import type Material from '#models/material'
import { fakePaymentGateway } from '#services/payment_gateway_service'
import { createMaterial, makePayoutReady, setPayoutRate } from '#tests/helpers/payouts'

async function signupVendor(client: any) {
  const email = `vendor-${string.uuid()}@test.com`
  const response = await client.post('/v1/auth/new-customer').json({
    firstName: 'Vendor',
    lastName: 'User',
    email,
    password: 'password123',
  })
  response.assertStatus(200)

  const user = await User.findByOrFail('email', email)
  user.role = 'vendor'
  await user.save()
  const vendor = await Vendor.create({
    uuid: string.uuid(),
    userId: user.id,
    ...activeVendorAttributes(),
  })
  await vendor
    .related('technologyCapabilities')
    .create({ technology: 'fdm', isPreferred: false, status: 'approved' })

  return { session: response.session(), user, vendor }
}

/**
 * An open-stage order any fdm-capable vendor can accept, with one part per
 * `lines` entry and the given production-time fee. Shipping ($29) and tax
 * are set so tests can check they never reach the payout.
 */
async function createOpenOrder(
  lines: { material: Material | null; total: string }[],
  productionTimeFeeAmount = '0.00'
) {
  const customer = await Customer.create({ uuid: string.uuid() })
  const project = await Project.create({
    uuid: string.uuid(),
    customerId: customer.id,
    status: 'draft',
  })
  const quote = await Quote.create({
    uuid: string.uuid(),
    projectId: project.id,
    revision: 1,
    subtotal: '100.00',
    tax: '8.00',
    total: '108.00',
    status: 'accepted',
    generatedBy: 'system',
    destinationCountry: 'US',
    shippingMethod: 'ups_2day',
    shippingFeeAmount: '29.00',
    productionTimeBusinessDays: 3,
    productionTimeFeeAmount,
  })
  const checkoutSession = await CheckoutSession.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    projectId: project.id,
    customerId: customer.id,
    status: 'active',
    expiresAt: DateTime.now().plus({ hours: 120 }),
  })
  const order = await Order.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    customerId: customer.id,
    projectId: project.id,
    orderNumber: `ORD-${string.generateRandom(6).toUpperCase()}`,
    subtotal: '100.00',
    tax: '8.00',
    total: '108.00',
    status: 'open',
    routingStage: 'open',
    shippingMethod: 'ups_2day',
    shippingFeeAmount: '29.00',
    productionTimeBusinessDays: 3,
    productionTimeFeeAmount,
  })

  const projectFiles: ProjectFile[] = []
  for (const line of lines) {
    const projectFile = await ProjectFile.create({
      uuid: string.uuid(),
      projectId: project.id,
      fileStorageKey: `projects/${project.uuid}/${string.uuid()}.stl`,
      originalName: 'part.stl',
      mimeType: 'model/stl',
      fileSize: 1024,
      status: 'completed',
      technology: 'fdm',
      materialId: line.material?.id ?? null,
    })
    projectFiles.push(projectFile)
    await order.related('items').create({
      projectFileId: projectFile.id,
      itemType: 'printing',
      description: `part ${projectFiles.length}`,
      quantity: 1,
      unitPrice: line.total,
      total: line.total,
    })
  }

  const { transactionId } = await fakePaymentGateway.authorize({ amount: 108, metadata: {} })
  await Payment.create({
    checkoutSessionId: checkoutSession.id,
    provider: 'stripe',
    transactionId,
    amount: '108.00',
    status: 'authorized',
    authorizedAt: DateTime.now(),
    providerFee: '0.00',
    netAmount: '108.00',
  })

  return { project, order, projectFiles }
}

function accept(client: any, session: any, order: Order) {
  return client.patch(`/v1/vendor/orders/${order.uuid}/accept`).withSession(session)
}

test.group('Payouts | acceptance gate', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(() => {
    fakePaymentGateway.reset()
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('refuses acceptance until the vendor has a payout method', async ({ client, assert }) => {
    const pla = await createMaterial('PLA')
    const { session, vendor } = await signupVendor(client)
    await setPayoutRate(vendor, pla, '70.00')
    const { order } = await createOpenOrder([{ material: pla, total: '100.00' }])

    const response = await accept(client, session, order)
    response.assertStatus(422)
    assert.include(response.body().error, 'get paid')

    await order.refresh()
    assert.equal(order.status, 'open')
    assert.lengthOf(await VendorPayout.all(), 0)
  })

  test('refuses acceptance when a material has no payout rate, naming it', async ({
    client,
    assert,
  }) => {
    const pla = await createMaterial('PLA')
    const petg = await createMaterial('PETG')
    const { session, vendor } = await signupVendor(client)
    await makePayoutReady(vendor)
    await setPayoutRate(vendor, pla, '70.00')
    const { order } = await createOpenOrder([
      { material: pla, total: '60.00' },
      { material: petg, total: '40.00' },
    ])

    const response = await accept(client, session, order)
    response.assertStatus(422)
    assert.include(response.body().error, 'PETG')
    assert.notInclude(response.body().error, 'PLA')

    await order.refresh()
    assert.equal(order.status, 'open')
    assert.isNull(order.vendorId)
    assert.lengthOf(await VendorPayout.all(), 0)
  })

  test('accepting snapshots the payout: item share per material plus the whole production-time fee', async ({
    client,
    assert,
  }) => {
    const pla = await createMaterial('PLA')
    const petg = await createMaterial('PETG')
    const { session, vendor } = await signupVendor(client)
    await makePayoutReady(vendor)
    await setPayoutRate(vendor, pla, '70.00')
    await setPayoutRate(vendor, petg, '62.50')
    const { order } = await createOpenOrder(
      [
        { material: pla, total: '33.33' },
        { material: petg, total: '66.67' },
      ],
      '15.00'
    )

    const response = await accept(client, session, order)
    response.assertStatus(200)

    const payout = await VendorPayout.findByOrFail('orderId', order.id)
    assert.equal(payout.vendorId, vendor.id)
    assert.equal(payout.status, 'pending')
    assert.equal(payout.provider, 'stripe')
    assert.isNull(payout.eligibleAt)

    // 33.33 × 70% = 23.331 → 23.33; 66.67 × 62.5% = 41.66875 → 41.67;
    // + 15.00 production-time fee. Shipping (29.00) and tax (8.00) excluded.
    assert.equal(payout.breakdown.lines[0].amount, '23.33')
    assert.equal(payout.breakdown.lines[1].amount, '41.67')
    assert.equal(payout.breakdown.lines[1].materialName, 'PETG')
    assert.equal(payout.breakdown.productionTimeFee, '15.00')
    assert.equal(payout.amount, '80.00')
    assert.equal(payout.breakdown.total, '80.00')
  })

  test('the open-order listing shows what the vendor would earn, or why they cannot accept', async ({
    client,
    assert,
  }) => {
    const pla = await createMaterial('PLA')
    const petg = await createMaterial('PETG')
    const { session, vendor } = await signupVendor(client)
    await makePayoutReady(vendor)
    await setPayoutRate(vendor, pla, '50.00')
    const { order: payable } = await createOpenOrder([{ material: pla, total: '100.00' }], '10.00')
    const { order: blocked } = await createOpenOrder([{ material: petg, total: '100.00' }])

    const response = await client.get('/v1/vendor/orders').withSession(session)
    response.assertStatus(200)
    const orders = response.body().data as Record<string, any>[]

    const payableRow = orders.find((row) => row.uuid === payable.uuid)!
    assert.equal(payableRow.estimatedPayout, '60.00')
    assert.isNull(payableRow.payoutBlockedReason)

    const blockedRow = orders.find((row) => row.uuid === blocked.uuid)!
    assert.isNull(blockedRow.estimatedPayout)
    assert.include(blockedRow.payoutBlockedReason, 'PETG')
  })

  test('a staff material change on an accepted order recalculates its payout', async ({
    client,
    assert,
  }) => {
    const pla = await createMaterial('PLA')
    const petg = await createMaterial('PETG')
    const tpu = await createMaterial('TPU')
    const { session, vendor } = await signupVendor(client)
    await makePayoutReady(vendor)
    await setPayoutRate(vendor, pla, '50.00')
    await setPayoutRate(vendor, petg, '80.00')
    const { order, projectFiles } = await createOpenOrder([{ material: pla, total: '100.00' }])
    const accepted = await accept(client, session, order)
    accepted.assertStatus(200)

    const adminEmail = `admin-${string.uuid()}@test.com`
    const adminSignup = await client.post('/v1/auth/new-customer').json({
      firstName: 'Staff',
      lastName: 'Admin',
      email: adminEmail,
      password: 'password123',
    })
    const adminUser = await User.findByOrFail('email', adminEmail)
    adminUser.role = 'admin'
    await adminUser.save()
    const adminSession = adminSignup.session()

    const toPetg = await client
      .patch(`/v1/projects/files/${projectFiles[0].uuid}/material`)
      .withSession(adminSession)
      .json({ materialUuid: petg.uuid })
    toPetg.assertStatus(200)
    const payout = await VendorPayout.findByOrFail('orderId', order.id)
    assert.equal(payout.amount, '80.00')
    assert.equal(payout.breakdown.lines[0].materialName, 'PETG')

    // No rate for TPU - the change is refused and nothing moves.
    const toTpu = await client
      .patch(`/v1/projects/files/${projectFiles[0].uuid}/material`)
      .withSession(adminSession)
      .json({ materialUuid: tpu.uuid })
    toTpu.assertStatus(422)
    await payout.refresh()
    assert.equal(payout.amount, '80.00')
    const projectFile = await ProjectFile.findOrFail(projectFiles[0].id)
    assert.equal(projectFile.materialId, petg.id)
  })
})
