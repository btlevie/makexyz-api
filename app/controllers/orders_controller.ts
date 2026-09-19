import type { HttpContext } from '@adonisjs/core/http'
import Order from '#models/order'
import Project from '#models/project'
import OrderTransformer from '#transformers/order_transformer'
import { isStaff, resolveProject } from '#services/project_grant_service'

export default class OrdersController {
  /**
   * The customer's own order for a project - a receipt/status check after
   * checkout. Public, same grant/customer/staff authorization as the quote
   * and checkout endpoints. Ordered by newest first and returning a single
   * order: one project drives one checkout flow at a time in practice,
   * though it isn't a DB-enforced constraint.
   */
  async show(ctx: HttpContext) {
    const { params, response, serialize } = ctx

    const project = isStaff(ctx)
      ? await Project.findBy('uuid', params.projectUuid)
      : await resolveProject(ctx, params.projectUuid)
    if (!project) {
      return response.notFound({ error: 'Project not found' })
    }

    const order = await Order.query()
      .where('projectId', project.id)
      .orderBy('createdAt', 'desc')
      .preload('items')
      .preload('address')
      .first()
    if (!order) {
      return response.notFound({ error: 'Order not found' })
    }

    return await serialize(OrderTransformer.transform(order))
  }
}
