import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Payment from '#models/payment'
import {
  getPaypalWebhookVerifier,
  WebhookVerificationError,
  type PaypalWebhookHeaders,
} from '#services/paypal_webhook_service'
import { hasProcessed, markProcessed } from '#services/webhook_event_service'
import { recordRefund, recordDispute } from '#services/refund_service'

export default class PaypalWebhooksController {
  /**
   * Reconciles events PayPal can only ever tell us about after the fact - a
   * refund issued from the dashboard, or a dispute/chargeback filed by the
   * customer's bank. Not part of the primary authorize/capture flow, which
   * is already synchronous (see checkout_service.ts).
   */
  async handle(ctx: HttpContext) {
    const { request, response } = ctx
    const rawBody = request.raw() ?? ''
    const headers: PaypalWebhookHeaders = {
      transmissionId: request.header('paypal-transmission-id') ?? '',
      transmissionTime: request.header('paypal-transmission-time') ?? '',
      transmissionSig: request.header('paypal-transmission-sig') ?? '',
      certUrl: request.header('paypal-cert-url') ?? '',
      authAlgo: request.header('paypal-auth-algo') ?? '',
    }

    let event: Record<string, any>
    try {
      event = await getPaypalWebhookVerifier().verify(rawBody, headers)
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return response.badRequest({ error: error.message })
      }
      throw error
    }

    const eventId = event.id as string
    const eventType = event.event_type as string

    await db.transaction(async (trx) => {
      if (await hasProcessed('paypal', eventId, trx)) {
        return
      }

      switch (eventType) {
        case 'PAYMENT.CAPTURE.REFUNDED': {
          const resource = event.resource ?? {}
          // The refund resource references its capture via a "up" link -
          // verify this shape against a real PayPal sandbox event before
          // relying on it in production.
          const captureId = (resource.links as { rel: string; href: string }[] | undefined)
            ?.find((link) => link.rel === 'up')
            ?.href?.split('/')
            .pop()
          const payment = captureId
            ? await Payment.query({ client: trx })
                .where('provider', 'paypal')
                .where('transactionId', captureId)
                .first()
            : null

          if (payment) {
            await recordRefund(
              {
                payment,
                amount: Number(resource.amount?.value ?? 0),
                reason: resource.note_to_payer ?? null,
                provider: 'paypal',
                providerRefundId: resource.id,
              },
              trx
            )
          }
          break
        }
        case 'CUSTOMER.DISPUTE.CREATED':
        case 'CUSTOMER.DISPUTE.RESOLVED': {
          const resource = event.resource ?? {}
          const disputedTransaction = resource.disputed_transactions?.[0] ?? {}
          const captureId = disputedTransaction.seller_transaction_id
          const payment = captureId
            ? await Payment.query({ client: trx })
                .where('provider', 'paypal')
                .where('transactionId', captureId)
                .first()
            : null

          if (payment) {
            await recordDispute(
              {
                payment,
                provider: 'paypal',
                providerDisputeId: resource.dispute_id,
                amount: Number(disputedTransaction.gross_amount?.value ?? 0),
                reason: resource.reason ?? null,
                status: resource.status ?? 'unknown',
                disputeEvent:
                  eventType === 'CUSTOMER.DISPUTE.CREATED' ? 'dispute_created' : 'dispute_closed',
              },
              trx
            )
          }
          break
        }
        default:
          break
      }

      await markProcessed('paypal', eventId, eventType, trx)
    })

    return response.ok({ received: true })
  }
}
