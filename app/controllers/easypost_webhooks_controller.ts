import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Shipment from '#models/shipment'
import {
  verifyEasypostWebhook,
  WebhookVerificationError,
  type EasypostEvent,
} from '#services/easypost_webhook_service'
import { hasProcessed, markProcessed } from '#services/webhook_event_service'
import { applyTrackerUpdate } from '#services/shipment_tracking_service'

export default class EasypostWebhooksController {
  /**
   * Carrier tracking updates for instant-quote labels - the only thing that
   * moves an order to 'shipped' and 'delivered' (see
   * shipment_tracking_service.ts). Anything that isn't a verification failure
   * returns 2xx, including events for shipments we don't know about, since
   * EasyPost retries everything else.
   */
  async handle(ctx: HttpContext) {
    const { request, response } = ctx
    const rawBody = request.raw() ?? ''

    let event: EasypostEvent
    try {
      event = verifyEasypostWebhook(rawBody, request.headers())
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return response.badRequest({ error: error.message })
      }
      throw error
    }

    await db.transaction(async (trx) => {
      if (await hasProcessed('easypost', event.id, trx)) {
        return
      }

      if (event.description === 'tracker.created' || event.description === 'tracker.updated') {
        const tracker = event.result ?? {}
        const shipment = await findShipment(tracker, trx)

        if (shipment && typeof tracker.status === 'string') {
          const updatedAt =
            typeof tracker.updated_at === 'string' ? DateTime.fromISO(tracker.updated_at) : null
          await applyTrackerUpdate(
            shipment.id,
            tracker.status,
            updatedAt?.isValid ? updatedAt : DateTime.now(),
            trx
          )
        }
      }

      await markProcessed('easypost', event.id, event.description, trx)
    })

    return response.ok({ received: true })
  }
}

/** By EasyPost shipment id first; tracking code as a fallback. */
async function findShipment(
  tracker: Record<string, any>,
  trx: Parameters<typeof applyTrackerUpdate>[3]
): Promise<Shipment | null> {
  if (typeof tracker.shipment_id === 'string') {
    const byShipmentId = await Shipment.query({ client: trx })
      .where('easypostShipmentId', tracker.shipment_id)
      .first()
    if (byShipmentId) return byShipmentId
  }
  if (typeof tracker.tracking_code === 'string') {
    return Shipment.query({ client: trx })
      .where('trackingNumber', tracker.tracking_code)
      .whereNot('status', 'cancelled')
      .orderBy('id', 'desc')
      .first()
  }
  return null
}
