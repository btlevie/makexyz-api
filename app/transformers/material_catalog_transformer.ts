import { BaseTransformer } from '@adonisjs/core/transformers'
import type { MaterialCatalogGroup } from '#services/material_service'

/**
 * Deliberately omits trueCostPerGram and densityGPerCm3 - those are internal
 * pricing inputs, and this endpoint is public.
 */
export default class MaterialCatalogTransformer extends BaseTransformer<MaterialCatalogGroup> {
  async toObject() {
    return {
      technology: this.resource.technology,
      materials: this.resource.materials.map((material) => ({
        uuid: material.uuid,
        name: material.name,
        description: material.description,
        isDefault: material.isDefault,
        colors: material.colors.map((color) => ({
          uuid: color.uuid,
          name: color.name,
          hex: color.hex,
          isDefault: color.isDefault,
        })),
      })),
    }
  }
}
