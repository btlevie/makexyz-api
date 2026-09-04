/**
 * Resolves the default material for a manufacturing technology.
 *
 * "Default" is an explicit, deliberate marker on the row (`is_default`), not
 * whichever material happens to match the technology - so which material a
 * technology resolves to is defined by data, not by controller-side name
 * strings.
 */
import Material from '#models/material'
import type MaterialColor from '#models/material_color'

export class MaterialConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaterialConfigurationError'
  }
}

export async function findMaterialByUuid(materialUuid: string): Promise<Material | null> {
  return Material.query().where('uuid', materialUuid).preload('colors').first()
}

export async function resolveDefaultMaterial(
  technology: Material['technology']
): Promise<Material> {
  const material = await Material.query()
    .where('technology', technology)
    .where('isDefault', true)
    .preload('colors')
    .first()

  if (!material) {
    throw new MaterialConfigurationError(
      `No default material configured for technology "${technology}".`
    )
  }

  return material
}

export function resolveDefaultColor(material: Material): MaterialColor {
  const defaults = material.colors.filter((c) => c.isDefault)

  if (defaults.length === 0) {
    throw new MaterialConfigurationError(
      `Material "${material.name}" has no default color configured.`
    )
  }
  if (defaults.length > 1) {
    throw new MaterialConfigurationError(
      `Material "${material.name}" has more than one default color configured.`
    )
  }

  return defaults[0]
}

export function findColorByUuid(material: Material, colorUuid: string): MaterialColor | null {
  return material.colors.find((c) => c.uuid === colorUuid) ?? null
}

/**
 * Keeps the current color if the new material still offers a color of the
 * same name, otherwise falls back to the new material's default. Matches by
 * name, not uuid: the old color's row belongs to the old material, so its
 * uuid never appears on the new material's rows even when "the same color"
 * conceptually exists on both.
 */
export function resolveColorForMaterialChange(
  currentColor: MaterialColor | null,
  newMaterial: Material
): MaterialColor {
  if (currentColor) {
    const stillAvailable = newMaterial.colors.find((c) => c.name === currentColor.name)
    if (stillAvailable) {
      return stillAvailable
    }
  }
  return resolveDefaultColor(newMaterial)
}

const ALL_MATERIAL_TECHNOLOGIES = ['fdm', 'sla', 'sls'] as const

/**
 * Checked at server boot (see start/material_defaults.ts) so a missing default
 * fails startup instead of a customer discovering it as a 500 on their first
 * upload. Defined here, rather than inline in the preload, so it can be
 * imported and tested directly without triggering the preload's top-level
 * check as a side effect.
 */
export async function assertDefaultMaterialsConfigured(): Promise<void> {
  const missing: string[] = []

  for (const technology of ALL_MATERIAL_TECHNOLOGIES) {
    const exists = await Material.query()
      .where('technology', technology)
      .where('isDefault', true)
      .first()

    if (!exists) {
      missing.push(technology)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `No default material configured for: ${missing.join(', ')}. Run the material seeder before starting the server.`
    )
  }
}
