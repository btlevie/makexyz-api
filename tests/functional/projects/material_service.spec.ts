import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Material from '#models/material'
import {
  assertDefaultMaterialsConfigured,
  MaterialConfigurationError,
  resolveDefaultMaterial,
} from '#services/material_service'

test.group('Material service | default resolution', (group) => {
  group.setup(async () => {
    const rollback = await testUtils.db().migrate()
    await rollback()
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    return async () => {
      const truncate = await testUtils.db().truncate()
      await truncate()
    }
  })

  test('resolves the material marked default for a technology', async ({ assert }) => {
    const pla = await Material.create({
      uuid: string.uuid(),
      name: 'PLA',
      technology: 'fdm',
      isDefault: true,
    })
    await Material.create({
      uuid: string.uuid(),
      name: 'Standard Resin',
      technology: 'sla',
      isDefault: true,
    })

    const resolved = await resolveDefaultMaterial('fdm')

    assert.equal(resolved.id, pla.id)
  })

  test('throws when no material is marked default for a technology', async ({ assert }) => {
    await Material.create({
      uuid: string.uuid(),
      name: 'PLA',
      technology: 'fdm',
      isDefault: false,
    })

    try {
      await resolveDefaultMaterial('fdm')
      assert.fail('expected MaterialConfigurationError')
    } catch (error) {
      assert.instanceOf(error, MaterialConfigurationError)
    }
  })

  test('assertDefaultMaterialsConfigured passes when every technology has a default', async () => {
    await Material.create({
      uuid: string.uuid(),
      name: 'PLA',
      technology: 'fdm',
      isDefault: true,
    })
    await Material.create({
      uuid: string.uuid(),
      name: 'Standard Resin',
      technology: 'sla',
      isDefault: true,
    })
    await Material.create({
      uuid: string.uuid(),
      name: 'Nylon PA12',
      technology: 'sls',
      isDefault: true,
    })

    await assertDefaultMaterialsConfigured()
  })

  test('assertDefaultMaterialsConfigured throws listing every technology missing a default', async ({
    assert,
  }) => {
    await Material.create({
      uuid: string.uuid(),
      name: 'PLA',
      technology: 'fdm',
      isDefault: true,
    })

    try {
      await assertDefaultMaterialsConfigured()
      assert.fail('expected an error')
    } catch (error) {
      assert.include((error as Error).message, 'sla')
      assert.include((error as Error).message, 'sls')
    }
  })
})
