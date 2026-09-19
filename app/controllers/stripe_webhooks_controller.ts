import type { HttpContext } from '@adonisjs/core/http'
import type Stripe from 'stripe'
import db from '@adonisjs/lucid/services/db'
import Payment from '#models/payment'
import { verifyStripeWebhook, WebhookVerificationError } from '#services/stripe_webhook_service'
import { hasProcessed, markProcessed } from '#services/webhook_event_service'
import { recordRefund, recordDispute } from '#services/refund_service'

export default class StripeWebhooksController {
  /**
   * Reconciles events Stripe can only ever tell us about after the fact - a
   * refund issued from the dashboard, or a dispute/chargeback filed by the
   * customer's bank. Not part of the primary authorize/capture flow, which
   * is already synchronous (see checkout_service.ts).
   */
  async handle(ctx: HttpContext) {
    const { request, response } = ctx
    const rawBody = request.raw() ?? ''
    const signature = request.header('stripe-signature')

    let event: Stripe.Event
    try {
      event = verifyStripeWebhook(rawBody, signature)
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return response.badRequest({ error: error.message })
      }
      throw error
    }

    await db.transaction(async (trx) => {
      if (await hasProcessed('stripe', event.id, trx)) {
        return
      }

      switch (event.type) {
        case 'charge.refunded': {
          const charge = event.data.object as Stripe.Charge
          const paymentIntentId =
            typeof charge.payment_intent === 'string'
              ? charge.payment_intent
              : charge.payment_intent?.id
          const payment = paymentIntentId
            ? await Payment.query({ client: trx })
                .where('provider', 'stripe')
                .where('transactionId', paymentIntentId)
                .first()
            : null

          if (payment) {
            // charge.refunded carries the full Charge with cumulative
            // amount_refunded plus a refunds list - refunds.data[0] is the
            // most recent refund. Verify this shape against a real Stripe
            // sandbox event before relying on it in production; subscribing
            // to the more granular charge.refund.updated event instead is
            // the alternative if this proves unreliable.
            const latestRefund = charge.refunds?.data?.[0]
            await recordRefund(
              {
                payment,
                amount: charge.amount_refunded / 100,
                reason: latestRefund?.reason ?? null,
                provider: 'stripe',
                providerRefundId: latestRefund?.id ?? charge.id,
              },
              trx
            )
          }
          break
        }
        case 'charge.dispute.created':
        case 'charge.dispute.closed': {
          const dispute = event.data.object as Stripe.Dispute
          const paymentIntentId =
            typeof dispute.payment_intent === 'string'
              ? dispute.payment_intent
              : dispute.payment_intent?.id
          const payment = paymentIntentId
            ? await Payment.query({ client: trx })
                .where('provider', 'stripe')
                .where('transactionId', paymentIntentId)
                .first()
            : null

          if (payment) {
            await recordDispute(
              {
                payment,
                provider: 'stripe',
                providerDisputeId: dispute.id,
                amount: dispute.amount / 100,
                reason: dispute.reason ?? null,
                status: dispute.status,
                disputeEvent:
                  event.type === 'charge.dispute.created' ? 'dispute_created' : 'dispute_closed',
              },
              trx
            )
          }
          break
        }
        default:
          break
      }

      await markProcessed('stripe', event.id, event.type, trx)
    })

    return response.ok({ received: true })
  }
}
