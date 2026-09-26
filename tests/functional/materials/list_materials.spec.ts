import string from '@adonisjs/core/helpers/string'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Material from '#models/material'

async function createMaterialWithColors(
  technology: 'fdm' | 'sla' | 'sls',
  name: string,
  colors: { name: string; hex?: string; isDefault: boolean }[],
  options: { isDefaultMaterial?: boolean } = {}
) {
  const material = await Material.create({
    uuid: string.uuid(),
    name,
    technology,
    description: `${name} description`,
    isDefault: options.isDefaultMaterial ?? false,
    trueCostPerGram: '0.02',
    densityGPerCm3: '1.24',
  })

  for (const color of colors) {
    await material.related('colors').create({
      uuid: string.uuid(),
      name: color.name,
      hex: color.hex ?? null,
      isDefault: color.isDefault,
    })
  }

  return material
}

test.group('Materials | list catalog', (group) => {
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

  test('groups materials and colors by technology, defaults first', async ({ client, assert }) => {
    await createMaterialWithColors('fdm', 'ABS', [{ name: 'Red', isDefault: true }])
    const pla = await createMaterialWithColors(
      'fdm',
      'PLA',
      [
        { name: 'White', hex: '#FFFFFF', isDefault: false },
        { name: 'Black', hex: '#000000', isDefault: false },
        { name: 'Grey', hex: '#808080', isDefault: true },
      ],
      { isDefaultMaterial: true }
    )
    await createMaterialWithColors('sla', 'Standard Resin', [{ name: 'Grey', isDefault: true }], {
      isDefaultMaterial: true,
    })

    const response = await client.get('/v1/materials')

    response.assertStatus(200)
    const data = response.body().data

    assert.deepEqual(
      data.map((entry: any) => entry.technology),
      ['fdm', 'sla', 'sls']
    )

    const fdm = data[0]
    assert.deepEqual(
      fdm.materials.map((m: any) => m.name),
      ['PLA', 'ABS']
    )
    assert.deepEqual(fdm.materials[0], {
      uuid: pla.uuid,
      name: 'PLA',
      description: 'PLA description',
      isDefault: true,
      colors: fdm.materials[0].colors,
    })
    assert.deepEqual(
      fdm.materials[0].colors.map((c: any) => [c.name, c.hex, c.isDefault]),
      [
        ['Grey', '#808080', true],
        ['Black', '#000000', false],
        ['White', '#FFFFFF', false],
      ]
    )

    assert.deepEqual(
      data[1].materials.map((m: any) => m.name),
      ['Standard Resin']
    )
    assert.deepEqual(data[2].materials, [])
  })

  test('does not expose internal pricing fields', async ({ client, assert }) => {
    await createMaterialWithColors('fdm', 'PLA', [{ name: 'Black', isDefault: true }], {
      isDefaultMaterial: true,
    })

    const response = await client.get('/v1/materials')

    response.assertStatus(200)
    const material = response.body().data[0].materials[0]
    assert.notProperty(material, 'trueCostPerGram')
    assert.notProperty(material, 'densityGPerCm3')
    assert.notProperty(material, 'id')
    assert.notProperty(material.colors[0], 'id')
    assert.notProperty(material.colors[0], 'materialId')
  })

  test('is public', async ({ client }) => {
    const response = await client.get('/v1/materials')

    response.assertStatus(200)
    response.assertBodyContains({ data: [{ technology: 'fdm', materials: [] }] })
  })
})
