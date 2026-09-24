import type { HttpContext } from '@adonisjs/core/http'
import Order from '#models/order'
import Project from '#models/project'
import OrderTransformer from '#transformers/order_transformer'
import { isStaff, resolveProject } from '#services/project_grant_service'

export default class OrdersController {
  /**
   * Every order for a project - a receipt/status check after checkout.
   * Public, same grant/customer/staff authorization as the quote and
   * checkout endpoints. A project used to drive at most one checkout flow,
   * but an admin-split quote now produces independent quote lineages that
   * each check out into their own order, so this returns all of them
   * (oldest first) rather than assuming just one.
   */
  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx

    const project = isStaff(ctx)
      ? await Project.findBy('uuid', params.projectUuid)
      : await resolveProject(ctx, params.projectUuid)
    if (!project) {
      return response.notFound({ error: 'Project not found' })
    }

    const orders = await Order.query()
      .where('projectId', project.id)
      .orderBy('createdAt', 'asc')
      .preload('items')
      .preload('address')
      .preload('shipments')

    return await serialize(OrderTransformer.transform(orders))
  }
}
