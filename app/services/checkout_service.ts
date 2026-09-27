/**
 * Checkout: authorizing payment against an accepted quote, creating the
 * resulting Order, and capturing (triggered by vendor acceptance - see
 * order_acceptance_service). Releasing an expired, never-accepted
 * authorization is a separate, later piece of this same flow - see
 * checkout_expiration_service.
 */
import string from '@adonisjs/core/helpers/string'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Address from '#models/address'
import CheckoutSession from '#models/checkout_session'
import Order from '#models/order'
import Payment from '#models/payment'
import Quote from '#models/quote'
import {
  getPaymentGateway,
  PaymentGatewayError,
  type AuthorizeResult,
  type PaymentProviderName,
} from '#services/payment_gateway_service'
import { getTaxCalculator } from '#services/tax_calculator_service'
import { routeNewOrder } from '#services/order_routing_service'

/**
 * How long a checkout session waits for a vendor to accept before releasing
 * the payment hold - provisional, needs confirmation (see the plan's "Open
 * items requiring sign-off"). Kept comfortably under Stripe's (~7 day) and
 * PayPal's (~29 day) own authorization-hold expiry windows.
 */
export const CHECKOUT_SESSION_EXPIRY_HOURS = 120

export class QuoteNotAcceptedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuoteNotAcceptedError'
  }
}

export class CheckoutSessionNotActiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckoutSessionNotActiveError'
  }
}

export class PaymentAuthorizationFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentAuthorizationFailedError'
  }
}

/**
 * Finds or creates the active checkout session for a quote - idempotent, so a
 * retried/duplicate create request never authorizes payment twice against the
 * same quote (a session is only ever created once per quote while active).
 */
export async function createCheckoutSession(
  projectId: number,
  quote: Quote,
  customerId: number | null
): Promise<CheckoutSession> {
  if (quote.status !== 'accepted') {
    throw new QuoteNotAcceptedError(`Quote ${quote.uuid} must be accepted before checkout`)
  }

  const existing = await CheckoutSession.query()
    .where('quoteId', quote.id)
    .where('status', 'active')
    .first()
  if (existing) {
    return existing
  }

  return CheckoutSession.create({
    uuid: string.uuid(),
    quoteId: quote.id,
    projectId,
    customerId,
    status: 'active',
    expiresAt: DateTime.now().plus({ hours: CHECKOUT_SESSION_EXPIRY_HOURS }),
  })
}

/**
 * What a checkout attempt produced: an authorized hold and its Order, or a
 * card that needs the customer to complete 3D Secure first (see
 * stripe_payment_gateway.ts) - the frontend hands `clientSecret` to Stripe.js
 * and then calls pay again, which resumes this same attempt.
 */
export type CheckoutAuthorization =
  | { status: 'authorized'; payment: Payment; order: Order }
  | { status: 'requires_action'; clientSecret: string }

/**
 * Authorizes payment (a hold, never a charge) against the checkout session's
 * quote, then creates the Order vendors will see - QuoteItems copied into
 * OrderItems as immutable snapshots, same pattern as everywhere else in this
 * codebase that snapshots a quote into an order-shaped record. The checkout
 * session is deliberately left `active`, not `completed` - the transaction
 * isn't done until a vendor accepts and payment is captured.
 *
 * If the card needs 3D Secure, records a `pending` Payment for the provider's
 * transaction and returns `requires_action` with no order. Calling this again
 * on the same session re-reads that transaction (gateway retrieve) instead of
 * authorizing a second time, and finishes the order once it's authorized.
 *
 * On a gateway failure (decline, failed verification, amount mismatch), marks
 * the session - and any pending Payment - `failed` and rethrows
 * PaymentAuthorizationFailedError; no order is created, and the customer can
 * start a new checkout session.
 */
export async function authorizeCheckoutSession(
  checkoutSession: CheckoutSession,
  quote: Quote,
  provider: PaymentProviderName,
  providerToken?: string
): Promise<CheckoutAuthorization> {
  if (checkoutSession.status !== 'active') {
    throw new CheckoutSessionNotActiveError(
      `Checkout session ${checkoutSession.uuid} is ${checkoutSession.status}, not active`
    )
  }

  // A session stays 'active' on success (see below), so that alone can't
  // prevent calling this twice - an existing authorized Payment is what makes
  // a retry idempotent instead of authorizing (and ordering) a second time.
  // A pending one is an attempt still awaiting 3D Secure, resumed below.
  const existingPayment = await Payment.query()
    .where('checkoutSessionId', checkoutSession.id)
    .first()
  if (existingPayment && existingPayment.status !== 'pending') {
    const existingOrder = await Order.findByOrFail('quoteId', quote.id)
    return { status: 'authorized', payment: existingPayment, order: existingOrder }
  }

  let result: AuthorizeResult
  try {
    result = existingPayment
      ? await getPaymentGateway(existingPayment.provider as PaymentProviderName).retrieve(
          existingPayment.transactionId!,
          { expectedAmount: quote.total }
        )
      : await getPaymentGateway(provider).authorize({
          expectedAmount: quote.total,
          quoteUuid: quote.uuid,
          metadata: { checkoutSessionUuid: checkoutSession.uuid },
          providerToken,
        })
  } catch (error) {
    await failAttempt(checkoutSession, existingPayment)

    if (error instanceof PaymentGatewayError) {
      throw new PaymentAuthorizationFailedError(error.message)
    }
    throw error
  }

  if (result.status === 'requires_action') {
    if (!existingPayment) {
      await Payment.create({
        checkoutSessionId: checkoutSession.id,
        provider,
        transactionId: result.transactionId,
        amount: quote.total,
        status: 'pending',
        providerFee: '0.00',
        netAmount: quote.total,
      })
    }
    return { status: 'requires_action', clientSecret: result.clientSecret }
  }

  const { payment, order } = await finalizeAuthorization(
    checkoutSession,
    quote,
    provider,
    result.transactionId,
    existingPayment
  )
  return { status: 'authorized', payment, order }
}

/** A failed attempt fails its session (and any pending Payment) - the next checkout starts fresh. */
async function failAttempt(checkoutSession: CheckoutSession, pendingPayment: Payment | null) {
  const now = DateTime.now()
  checkoutSession.status = 'failed'
  checkoutSession.failedAt = now
  await checkoutSession.save()

  if (pendingPayment) {
    pendingPayment.status = 'failed'
    pendingPayment.failedAt = now
    await pendingPayment.save()
  }
}

/**
 * Records the authorized hold (a new Payment, or the pending one flipping to
 * authorized) and creates the Order, then routes it.
 */
async function finalizeAuthorization(
  checkoutSession: CheckoutSession,
  quote: Quote,
  provider: PaymentProviderName,
  transactionId: string,
  pendingPayment: Payment | null
): Promise<{ payment: Payment; order: Order }> {
  await quote.load('items')

  return db
    .transaction(async (trx) => {
      let payment: Payment
      if (pendingPayment) {
        pendingPayment.useTransaction(trx)
        pendingPayment.merge({ status: 'authorized', authorizedAt: DateTime.now() })
        await pendingPayment.save()
        payment = pendingPayment
      } else {
        payment = await Payment.create(
          {
            checkoutSessionId: checkoutSession.id,
            provider,
            transactionId,
            amount: quote.total,
            status: 'authorized',
            authorizedAt: DateTime.now(),
            // Not known until capture (see captureCheckoutSession below).
            // Net defaults to the full amount since no fee has been taken yet.
            providerFee: '0.00',
            netAmount: quote.total,
          },
          { client: trx }
        )
      }

      // Backfill the quote's address to the now-guaranteed-resolved customer -
      // it may have been created unowned (customerId: null) at configure
      // time, for a project that had no Customer yet. Safe/idempotent for an
      // existing saved address too (already owned by this same customer).
      await Address.query({ client: trx })
        .where('id', quote.addressId!)
        .update({ customer_id: checkoutSession.customerId })

      const order = await Order.create(
        {
          uuid: string.uuid(),
          quoteId: quote.id,
          customerId: checkoutSession.customerId,
          projectId: checkoutSession.projectId,
          orderNumber: `ORD-${string.generateRandom(10).toUpperCase()}`,
          subtotal: quote.subtotal,
          tax: quote.tax,
          total: quote.total,
          status: 'open',
          shippingMethod: quote.shippingMethod,
          shippingFeeAmount: quote.shippingFeeAmount,
          productionTimeBusinessDays: quote.productionTimeBusinessDays,
          productionTimeFeeAmount: quote.productionTimeFeeAmount,
          addressId: quote.addressId!,
        },
        { client: trx }
      )

      await order.related('items').createMany(
        quote.items.map((item) => ({
          projectFileId: item.projectFileId,
          itemType: item.itemType,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        }))
      )

      return { payment, order }
    })
    .then(async (result) => {
      // Best-effort, after the transaction commits: routing is a separate
      // concern from "was payment authorized and the order created" - a
      // missing/invalid routing config must not undo an already-successful
      // authorization. An unrouted order is a recoverable, visible problem
      // (routingStage stays null); silently failing the whole request with
      // money already held is not.
      try {
        await routeNewOrder(result.order)
      } catch (error) {
        logger.error(
          { orderUuid: result.order.uuid, error: String(error) },
          'Failed to route a newly-created order'
        )
      }
      return result
    })
}

export class OrderNotCapturableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderNotCapturableError'
  }
}

/**
 * Captures the held payment - the point where money actually moves - and
 * finalizes the Stripe Tax transaction, only now that the payment has
 * actually run (per the correction driving this design: tax isn't finalized
 * merely because it was authorized). Called from vendor acceptance
 * (acceptOrder), after the order has already been atomically flipped to
 * 'accepted' - never directly.
 *
 * Locks the payment row and re-checks its status before capturing. The
 * order's own status is NOT the guard here - by the time this runs, the order
 * is expected to already be 'accepted' (that atomic transition is what
 * prevented two vendors, or a vendor and the expiration job, from both
 * winning). The payment's status is what protects this specific step: it can
 * only ever move from 'authorized' once, so a retry or a concurrent
 * expiration-release attempt on the same payment finds it already
 * captured/cancelled and backs off instead of acting twice.
 */
export async function captureCheckoutSession(order: Order): Promise<Payment> {
  return db.transaction(async (trx) => {
    const checkoutSession = await CheckoutSession.query({ client: trx })
      .where('quoteId', order.quoteId!)
      .firstOrFail()
    const payment = await Payment.query({ client: trx })
      .where('checkoutSessionId', checkoutSession.id)
      .forUpdate()
      .firstOrFail()
    if (payment.status !== 'authorized') {
      throw new OrderNotCapturableError(
        `Payment for order ${order.uuid} is ${payment.status}, not authorized - it may have already been captured or released`
      )
    }
    // Scoped to this transaction, same as every other query here - a plain
    // (untransacted) query would try to acquire a second connection from a
    // pool the open transaction may be holding exclusively (SQLite's
    // single-connection pool in tests), deadlocking against itself.
    const quote = await Quote.query({ client: trx }).where('id', order.quoteId!).firstOrFail()

    const result = await getPaymentGateway(payment.provider as PaymentProviderName).capture(
      payment.transactionId!
    )

    payment.useTransaction(trx)
    payment.transactionId = result.transactionId
    payment.status = 'captured'
    payment.capturedAt = DateTime.now()
    payment.providerFee = result.providerFee.toFixed(2)
    payment.netAmount = result.netAmount.toFixed(2)
    await payment.save()

    if (quote.stripeTaxCalculationId) {
      await getTaxCalculator().finalize(quote.stripeTaxCalculationId)
    }

    checkoutSession.useTransaction(trx)
    checkoutSession.status = 'completed'
    checkoutSession.completedAt = DateTime.now()
    await checkoutSession.save()

    return payment
  })
}

/**
 * Releases a checkout session's held authorization once no vendor accepted
 * before its expires_at - meant to run on a schedule (see
 * app/jobs/expire_checkout_sessions.ts). Locks the order row and re-checks its
 * status first, so this can't release a hold that vendor acceptance just
 * captured (the same race guard captureCheckoutSession applies from the other
 * direction) - one of the two will find the order already moved and back off.
 *
 * Never throws for one session's failure - callers process many sessions in
 * one run and a single bad one (e.g. the gateway is down) must not stop the
 * rest from expiring.
 */
export async function expireCheckoutSession(checkoutSession: CheckoutSession): Promise<void> {
  await db.transaction(async (trx) => {
    const order = await Order.query({ client: trx })
      .where('quoteId', checkoutSession.quoteId!)
      .forUpdate()
      .first()
    if (order && order.status !== 'open') {
      // A vendor already accepted (or this was already released) - nothing to
      // release.
      return
    }

    // An authorized hold is released; a pending one (customer never finished
    // 3D Secure) holds no money but is abandoned at the provider too.
    const payment = await Payment.query({ client: trx })
      .where('checkoutSessionId', checkoutSession.id)
      .whereIn('status', ['authorized', 'pending'])
      .first()
    if (payment) {
      await getPaymentGateway(payment.provider as PaymentProviderName).cancel(
        payment.transactionId!
      )
      payment.useTransaction(trx)
      payment.status = 'cancelled'
      payment.cancelledAt = DateTime.now()
      await payment.save()
    }

    if (order) {
      order.useTransaction(trx)
      order.status = 'cancelled'
      await order.save()
    }

    checkoutSession.useTransaction(trx)
    checkoutSession.status = 'expired'
    checkoutSession.expiredAt = DateTime.now()
    await checkoutSession.save()
  })
}
