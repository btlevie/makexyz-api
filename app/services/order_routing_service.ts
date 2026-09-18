/**
 * Order routing: preferred-vendor queue -> open queue.
 *
 * All vendors preferred for an order's required technologies see it
 * simultaneously during the preferred window (first to accept wins, no
 * priority ordering between them). If no vendor is preferred across every
 * required technology, an order skips the preferred stage entirely. Once the
 * window closes, the order opens to every capability-matching vendor,
 * preferred ones included - a superset, not a fallback that excludes them.
 *
 * There is deliberately no in-code fallback configuration - same reasoning as
 * pricing_config_service/production_time_service: silently defaulting the
 * routing window is worse than refusing to route.
 */
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Order from '#models/order'
import OrderRoutingConfig from '#models/order_routing_config'

export class OrderRoutingConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderRoutingConfigurationError'
  }
}

export type ResolvedOrderRoutingConfig = {
  id: number
  version: number
  preferredWindowHours: number
}

export async function getActiveOrderRoutingConfig(): Promise<ResolvedOrderRoutingConfig> {
  const active = await OrderRoutingConfig.query().where('isActive', true)

  if (active.length === 0) {
    throw new OrderRoutingConfigurationError(
      'No active order-routing configuration found. Seed or activate one before routing orders.'
    )
  }
  if (active.length > 1) {
    const ids = active.map((config) => config.id).join(', ')
    throw new OrderRoutingConfigurationError(
      `Expected exactly one active order-routing configuration, found ${active.length} (ids: ${ids}).`
    )
  }

  const config = active[0]
  if (!Number.isFinite(config.preferredWindowHours) || config.preferredWindowHours <= 0) {
    throw new OrderRoutingConfigurationError(
      `Active order-routing configuration ${config.id} (version ${config.version}) has an invalid preferredWindowHours (${config.preferredWindowHours})`
    )
  }

  return { id: config.id, version: config.version, preferredWindowHours: config.preferredWindowHours }
}

/** The distinct set of technologies an order needs a vendor to fulfill. */
export async function getRequiredTechnologies(order: Order): Promise<string[]> {
  await order.load('items', (query) => query.preload('projectFile'))
  const technologies = new Set<string>()
  for (const item of order.items) {
    if (item.projectFile) {
      technologies.add(item.projectFile.technology)
    }
  }
  return [...technologies]
}

/**
 * Whether any single vendor is preferred across every one of the given
 * technologies - it has to be one vendor able to fulfill the whole order, not
 * different preferred vendors for different lines.
 */
async function hasFullyPreferredVendor(requiredTechnologies: string[]): Promise<boolean> {
  if (requiredTechnologies.length === 0) {
    return false
  }

  const rows = await db
    .from('vendor_technology_capabilities')
    .whereIn('technology', requiredTechnologies)
    .where('is_preferred', true)
    .groupBy('vendor_id')
    .havingRaw('count(distinct technology) = ?', [requiredTechnologies.length])
    .select('vendor_id')

  return rows.length > 0
}

/**
 * Sets routing_stage/routing_expires_at on a freshly-created order. Call this
 * once, right after order creation.
 */
export async function routeNewOrder(order: Order): Promise<void> {
  const requiredTechnologies = await getRequiredTechnologies(order)
  const isPreferredEligible = await hasFullyPreferredVendor(requiredTechnologies)

  if (isPreferredEligible) {
    const config = await getActiveOrderRoutingConfig()
    order.routingStage = 'preferred'
    order.routingExpiresAt = DateTime.now().plus({ hours: config.preferredWindowHours })
  } else {
    order.routingStage = 'open'
    order.routingExpiresAt = null
  }

  await order.save()
}

/**
 * Whether the given vendor may accept the given order right now - eligibility
 * differs by stage: 'preferred' requires the vendor to be preferred across
 * every required technology; 'open' only requires capability (preferred or
 * not).
 */
export async function vendorCanAcceptOrder(vendorId: number, order: Order): Promise<boolean> {
  const requiredTechnologies = await getRequiredTechnologies(order)
  if (requiredTechnologies.length === 0) {
    return false
  }

  const query = db
    .from('vendor_technology_capabilities')
    .where('vendor_id', vendorId)
    .whereIn('technology', requiredTechnologies)

  if (order.routingStage === 'preferred') {
    query.where('is_preferred', true)
  }

  const rows = await query.select('technology')
  return rows.length === requiredTechnologies.length
}

/**
 * Moves every order past its routing_expires_at from 'preferred' to 'open' -
 * meant to run on a schedule (see app/jobs), same pattern as
 * expire_abandoned_projects.ts.
 */
export async function escalateExpiredPreferredOrders(): Promise<number> {
  const result = await Order.query()
    .where('routingStage', 'preferred')
    .whereNotNull('routingExpiresAt')
    .where('routingExpiresAt', '<=', DateTime.now().toSQL())
    .update({ routing_stage: 'open', routing_expires_at: null })

  // Lucid's bulk update returns an array of affected row counts per dialect,
  // not a stable single number - callers only need "did anything change".
  return Array.isArray(result) ? Number(result[0] ?? 0) : Number(result)
}
