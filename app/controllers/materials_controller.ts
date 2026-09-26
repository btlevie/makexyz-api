import type { HttpContext } from '@adonisjs/core/http'
import MaterialCatalogTransformer from '#transformers/material_catalog_transformer'
import { listMaterialCatalog } from '#services/material_service'

export default class MaterialsController {
  /**
   * Feeds the instant-quote technology/material/color pickers - public, no
   * auth needed, matches the rest of the anonymous instant-quote flow's read
   * endpoints. The uuids returned here are what the project-file
   * material/color PATCH endpoints accept.
   */
  async index({ serialize }: HttpContext) {
    const catalog = await listMaterialCatalog()
    return await serialize(MaterialCatalogTransformer.transform(catalog))
  }
}
