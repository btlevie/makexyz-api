import string from '@adonisjs/core/helpers/string'
import Material from '#models/material'
import MaterialColor from '#models/material_color'
import { BaseSeeder } from '@adonisjs/lucid/seeders'

type ColorSeed = { name: string; hex: string | null; isDefault: boolean }

// Not updateOrCreateMany: that applies its whole payload on every run, and
// uuid must only ever be set at genuine creation - never regenerated for a
// row that already exists.
async function seedColors(material: Material, colors: ColorSeed[]) {
  for (const color of colors) {
    const existing = await MaterialColor.query()
      .where('materialId', material.id)
      .where('name', color.name)
      .first()
    if (existing) {
      existing.merge(color)
      await existing.save()
    } else {
      await MaterialColor.create({ ...color, materialId: material.id, uuid: string.uuid() })
    }
  }
}

export default class extends BaseSeeder {
  async run() {
    // trueCostPerGram is the internal filament cost basis for the bulk pricing
    // floor - a $20/kg PLA spool works out to $0.02/g. It stays null for resin
    // and nylon powder: there's no SLA/SLS pricing calculator yet to consume it,
    // so seeding a fabricated number would be misleading. densityGPerCm3 values
    // are approximate reference figures (verify before relying on them for real
    // pricing) used to rescale slicer-derived grams when a project file's
    // material changes (see ProjectFilesController#updateMaterial). colors are
    // placeholder swatches to verify before relying on them for real product
    // data - kept alongside each material rather than in a separate lookup so
    // they can't drift out of sync with it.
    const materials = [
      {
        name: 'PLA',
        technology: 'fdm' as const,
        isDefault: true,
        trueCostPerGram: '0.02',
        densityGPerCm3: '1.24',
        colors: [
          { name: 'Black', hex: '#1A1A1A', isDefault: true },
          { name: 'White', hex: '#F5F5F5', isDefault: false },
          { name: 'Gray', hex: '#808080', isDefault: false },
        ],
      },
      {
        name: 'PETG',
        technology: 'fdm' as const,
        isDefault: true,
        trueCostPerGram: '0.02',
        densityGPerCm3: '1.24',
        colors: [
          { name: 'Black', hex: '#1A1A1A', isDefault: true },
          { name: 'White', hex: '#F5F5F5', isDefault: false },
          { name: 'Blue', hex: '#0000FF', isDefault: false },
        ],
      },
      {
        name: 'Standard Resin',
        technology: 'sla' as const,
        isDefault: true,
        trueCostPerGram: null,
        densityGPerCm3: '1.10',
        colors: [
          { name: 'Clear', hex: null, isDefault: true },
          { name: 'Gray', hex: '#8A8A8A', isDefault: false },
        ],
      },
      {
        name: 'Nylon PA12',
        technology: 'sls' as const,
        isDefault: true,
        trueCostPerGram: null,
        densityGPerCm3: '1.01',
        colors: [
          { name: 'Natural White', hex: '#EDE8DD', isDefault: true },
          { name: 'Black', hex: '#1A1A1A', isDefault: false },
        ],
      },
    ]

    for (const { colors, ...material } of materials) {
      const existing = await Material.findBy('name', material.name)
      const row = existing ?? (await Material.create({ ...material, uuid: string.uuid() }))
      if (existing) {
        existing.merge(material)
        await existing.save()
      }

      await seedColors(row, colors)
    }
  }
}
