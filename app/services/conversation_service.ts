/**
 * Conversation lifecycle: creating inquiries and order threads, deciding
 * whether a thread still accepts messages, and closing threads that have run
 * their course. See docs/plans/messaging_moderation.md ("Conversation model
 * and scope") and docs/DATABASE_FLOW.md (Messaging).
 *
 * There is no way to message an arbitrary user. A conversation exists only
 * because of an inquiry (a verified customer writing to an active vendor), an
 * accepted order, or a support request - and vendors can never start one.
 */
import string from '@adonisjs/core/helpers/string'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import Conversation from '#models/conversation'
import ConversationBlock from '#models/conversation_block'
import ConversationParticipant from '#models/conversation_participant'
import Customer from '#models/customer'
import Message from '#models/message'
import ModerationCase from '#models/moderation_case'
import Order from '#models/order'
import type User from '#models/user'
import type Vendor from '#models/vendor'
import { isEmailVerified } from '#services/email_verification_service'
import { postSystemMessage } from '#services/message_service'
import { noteVendorBlock } from '#services/messaging_risk_service'

/** An inquiry with no messages for this long becomes read-only. */
export const INQUIRY_IDLE_DAYS = 60
/** The customer can reopen an idle inquiry by posting, within this many days of it closing. */
export const INQUIRY_REOPEN_DAYS = 90
/** An order thread stays open this long after delivery - the defect/dispute window. */
export const ORDER_THREAD_DAYS_AFTER_DELIVERY = 14
/** New inquiries a customer may open per rolling 24 hours. */
export const INQUIRY_DAILY_CAP_NEW_ACCOUNT = 5
export const INQUIRY_DAILY_CAP = 20
/** Accounts younger than this get the lower inquiry cap. */
export const NEW_ACCOUNT_DAYS = 7

/** How a white-label vendor appears to the customer in an instant-quote order thread. */
export const ORDER_THREAD_VENDOR_NAME = 'Your manufacturer'

/** Order statuses in which the order's thread is live (delivered also needs the window). */
const LIVE_ORDER_STATUSES: Order['status'][] = [
  'accepted',
  'in_progress',
  'ready_to_ship',
  'shipped',
  'delivered',
]

export type InquiryRefusal =
  | 'email_unverified'
  | 'not_a_customer'
  | 'vendor_unavailable'
  | 'blocked'
  | 'daily_cap_reached'
  | 'already_open'

export class InquiryNotAllowedError extends Error {
  constructor(
    public code: InquiryRefusal,
    message: string,
    public existingConversationUuid: string | null = null
  ) {
    super(message)
    this.name = 'InquiryNotAllowedError'
  }
}

export class ConversationClosedError extends Error {
  constructor(message = 'This conversation is closed') {
    super(message)
    this.name = 'ConversationClosedError'
  }
}

/** "Jane D." - customers are never shown to vendors by full name or email. */
export function customerDisplayName(customer: Customer, user?: User | null): string {
  const [first, ...rest] = (
    [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
    user?.fullName ||
    ''
  )
    .trim()
    .split(/\s+/)
  if (!first) {
    return 'Customer'
  }
  const last = rest.at(-1)
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code
  // Postgres unique_violation; SQLite (tests) constraint failure.
  return code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT'
}

/**
 * Opens an inquiry from a customer to a vendor. The first message is sent
 * separately, through the normal moderation path (message_service.ts); until
 * it's delivered, the vendor doesn't see the conversation at all.
 */
export async function createInquiry(input: {
  user: User
  customer: Customer
  vendor: Vendor
  subject: string
}): Promise<Conversation> {
  const { user, customer, vendor, subject } = input

  if (user.role !== 'customer') {
    throw new InquiryNotAllowedError('not_a_customer', 'Only customer accounts can message vendors')
  }
  if (!isEmailVerified(user)) {
    throw new InquiryNotAllowedError(
      'email_unverified',
      'Confirm your email address before messaging vendors'
    )
  }
  // TODO(manual-quotes): also require the vendor's published profile and
  // accepting_inquiries flag once vendor profiles exist (docs/plans/manual_quotes.md).
  if (vendor.status !== 'active') {
    throw new InquiryNotAllowedError('vendor_unavailable', 'This vendor is not taking inquiries')
  }

  const blocked = await ConversationBlock.query()
    .where('vendorId', vendor.id)
    .where('customerId', customer.id)
    .first()
  if (blocked) {
    // Worded like any unavailable vendor - the customer isn't told they were blocked.
    throw new InquiryNotAllowedError('blocked', 'This vendor is not taking inquiries')
  }

  const existing = await Conversation.query()
    .where('kind', 'inquiry')
    .where('status', 'open')
    .where('customerId', customer.id)
    .where('vendorId', vendor.id)
    .first()
  if (existing) {
    throw new InquiryNotAllowedError(
      'already_open',
      'You already have an open conversation with this vendor',
      existing.uuid
    )
  }

  const isNewAccount =
    !user.createdAt || user.createdAt > DateTime.now().minus({ days: NEW_ACCOUNT_DAYS })
  const cap = isNewAccount ? INQUIRY_DAILY_CAP_NEW_ACCOUNT : INQUIRY_DAILY_CAP
  const openedToday = await Conversation.query()
    .where('kind', 'inquiry')
    .where('customerId', customer.id)
    .where('createdAt', '>', DateTime.now().minus({ hours: 24 }).toSQL()!)
    .count('* as total')
    .first()
  if (Number(openedToday?.$extras.total ?? 0) >= cap) {
    throw new InquiryNotAllowedError(
      'daily_cap_reached',
      `You can start up to ${cap} new conversations a day - please try again tomorrow`
    )
  }

  try {
    return await db.transaction(async (trx) => {
      const conversation = await Conversation.create(
        {
          uuid: string.uuid(),
          kind: 'inquiry',
          customerId: customer.id,
          vendorId: vendor.id,
          subject,
          status: 'open',
        },
        { client: trx }
      )
      await ConversationParticipant.createMany(
        [
          {
            conversationId: conversation.id,
            role: 'customer',
            customerId: customer.id,
            displayName: customerDisplayName(customer, user),
          },
          {
            conversationId: conversation.id,
            role: 'vendor',
            vendorId: vendor.id,
            displayName: vendor.displayName ?? 'Manufacturer',
          },
        ],
        { client: trx }
      )
      return conversation
    })
  } catch (error) {
    // Two concurrent requests - the partial unique index let only one through.
    if (isUniqueViolation(error)) {
      const winner = await Conversation.query()
        .where('kind', 'inquiry')
        .where('status', 'open')
        .where('customerId', customer.id)
        .where('vendorId', vendor.id)
        .first()
      throw new InquiryNotAllowedError(
        'already_open',
        'You already have an open conversation with this vendor',
        winner?.uuid ?? null
      )
    }
    throw error
  }
}

/**
 * Opens the thread between an instant-quote order's customer and the vendor
 * that just accepted it. Idempotent (one thread per order and vendor). The
 * vendor stays white-label: the customer sees "Your manufacturer".
 */
export async function openOrderThread(
  order: Order,
  trx?: TransactionClientContract
): Promise<Conversation | null> {
  if (!order.vendorId || !order.customerId) {
    return null
  }
  const client = trx ? { client: trx } : {}

  const existing = await Conversation.query(client)
    .where('orderId', order.id)
    .where('vendorId', order.vendorId)
    .first()
  if (existing) {
    return existing
  }

  const customer = await Customer.query(client).where('id', order.customerId).first()
  const run = async (tx: TransactionClientContract) => {
    const conversation = await Conversation.create(
      {
        uuid: string.uuid(),
        kind: 'order',
        customerId: order.customerId,
        vendorId: order.vendorId,
        projectId: order.projectId,
        orderId: order.id,
        subject: `Order ${order.orderNumber}`,
        status: 'open',
      },
      { client: tx }
    )
    await ConversationParticipant.createMany(
      [
        {
          conversationId: conversation.id,
          role: 'customer',
          customerId: order.customerId,
          displayName: customer ? customerDisplayName(customer) : 'Customer',
        },
        {
          conversationId: conversation.id,
          role: 'vendor',
          vendorId: order.vendorId,
          displayName: ORDER_THREAD_VENDOR_NAME,
        },
      ],
      { client: tx }
    )
    return conversation
  }

  return trx ? run(trx) : db.transaction(run)
}

/**
 * Best-effort wrapper for callers that must not fail because of messaging
 * (vendor acceptance has already captured payment by the time this runs).
 */
export async function openOrderThreadSafely(order: Order): Promise<void> {
  try {
    await openOrderThread(order)
  } catch (error) {
    logger.error(
      { orderUuid: order.uuid, error: String(error) },
      'Failed to open the order conversation'
    )
  }
}

/** Whether an order thread's order still allows messaging for this conversation's vendor. */
export function isOrderLive(conversation: Conversation, order: Order | null, now = DateTime.now()) {
  if (!order || order.vendorId !== conversation.vendorId) {
    return false
  }
  if (!LIVE_ORDER_STATUSES.includes(order.status)) {
    return false
  }
  if (order.status === 'delivered') {
    const deliveredAt = order.deliveredAt ?? order.updatedAt
    return !deliveredAt || deliveredAt > now.minus({ days: ORDER_THREAD_DAYS_AFTER_DELIVERY })
  }
  return true
}

/**
 * Whether `participant` may post in `conversation` right now. Returns
 * `'reopen'` when the post is allowed because it reopens an idle inquiry.
 * Throws ConversationClosedError otherwise.
 */
export async function assertCanPost(
  conversation: Conversation,
  participant: ConversationParticipant
): Promise<'open' | 'reopen'> {
  if (conversation.kind === 'order') {
    const order = conversation.orderId ? await Order.find(conversation.orderId) : null
    if (conversation.status !== 'open' || !isOrderLive(conversation, order)) {
      throw new ConversationClosedError()
    }
    return 'open'
  }

  if (conversation.status === 'open') {
    return 'open'
  }

  const reopenable =
    conversation.kind === 'inquiry' &&
    conversation.status === 'read_only' &&
    conversation.closedReason === 'idle' &&
    participant.role === 'customer' &&
    !!conversation.readOnlyAt &&
    conversation.readOnlyAt > DateTime.now().minus({ days: INQUIRY_REOPEN_DAYS })
  if (reopenable) {
    return 'reopen'
  }
  throw new ConversationClosedError()
}

async function closeConversation(
  conversation: Conversation,
  reason: NonNullable<Conversation['closedReason']>,
  trx?: TransactionClientContract
) {
  if (trx) conversation.useTransaction(trx)
  conversation.merge({ status: 'read_only', closedReason: reason, readOnlyAt: DateTime.now() })
  await conversation.save()
}

/** The vendor passes on an inquiry. The customer sees a system message. */
export async function declineInquiry(
  conversation: Conversation,
  reason?: string,
  reasonCode?: 'not_a_fit' | 'no_capacity' | 'prohibited_item' | 'other'
) {
  if (conversation.kind !== 'inquiry' || conversation.status !== 'open') {
    throw new ConversationClosedError('Only an open inquiry can be declined')
  }
  await db.transaction(async (trx) => {
    conversation.useTransaction(trx)
    conversation.firstVendorResponseAt ??= DateTime.now()
    await closeConversation(conversation, 'declined', trx)

    // A vendor turning work down as prohibited is the check the text rules
    // can't do (they never see the model's geometry) - staff get a case on
    // the customer's opening message.
    if (reasonCode === 'prohibited_item') {
      const opener = await Message.query({ client: trx })
        .where('conversationId', conversation.id)
        .whereNotNull('senderCustomerId')
        .orderBy('seq', 'asc')
        .first()
      await ModerationCase.create(
        {
          uuid: string.uuid(),
          messageId: opener?.id ?? null,
          customerId: conversation.customerId,
          vendorId: null,
          source: 'prohibited_item',
          priority: 20,
          status: 'open',
          patternNote: reason ?? null,
          missedByAutomation: true,
        },
        { client: trx }
      )
    }
  })
  await postSystemMessage(
    conversation,
    reason
      ? `The manufacturer declined this inquiry: ${reason}`
      : 'The manufacturer declined this inquiry.'
  )
}

/**
 * The vendor blocks the customer: this inquiry closes, the customer can't
 * open another with this vendor, and staff get a case (several vendors
 * blocking the same customer is a strong signal).
 */
export async function blockInquiryCustomer(
  conversation: Conversation,
  vendorUser: User,
  reason?: string
) {
  if (conversation.kind !== 'inquiry' || !conversation.customerId || !conversation.vendorId) {
    throw new ConversationClosedError('Only an inquiry customer can be blocked')
  }
  const customerId = conversation.customerId
  const vendorId = conversation.vendorId

  await db.transaction(async (trx) => {
    const moderationCase = await ModerationCase.create(
      {
        uuid: string.uuid(),
        customerId,
        vendorId,
        source: 'report',
        priority: 60,
        status: 'open',
        patternNote: reason ?? null,
        missedByAutomation: false,
      },
      { client: trx }
    )
    const existingBlock = await ConversationBlock.query({ client: trx })
      .where('vendorId', vendorId)
      .where('customerId', customerId)
      .first()
    if (!existingBlock) {
      await ConversationBlock.create(
        {
          vendorId,
          customerId,
          createdById: vendorUser.id,
          reason: reason ?? null,
          caseId: moderationCase.id,
        },
        { client: trx }
      )
    }
    if (conversation.status === 'open') {
      await closeConversation(conversation, 'blocked', trx)
    }
  })
  // Several vendors blocking the same customer holds them for review.
  await noteVendorBlock(customerId)
}

/**
 * Hourly sweep (CloseExpiredConversations job): inquiries idle past
 * INQUIRY_IDLE_DAYS, and order threads whose order is finished (delivered
 * past the window, refunded, cancelled) or no longer with this vendor.
 * Closing is only bookkeeping - assertCanPost already refuses posts to a
 * finished order at the moment it finishes.
 */
export async function closeExpiredConversations(now = DateTime.now()) {
  let closed = 0

  const idleCutoff = now.minus({ days: INQUIRY_IDLE_DAYS }).toSQL()!
  const idle = await Conversation.query()
    .where('kind', 'inquiry')
    .where('status', 'open')
    .where((query) =>
      query
        .where('lastMessageAt', '<', idleCutoff)
        .orWhere((inner) => inner.whereNull('lastMessageAt').where('createdAt', '<', idleCutoff))
    )
  for (const conversation of idle) {
    await closeConversation(conversation, 'idle')
    closed++
  }

  const orderThreads = await Conversation.query()
    .where('kind', 'order')
    .where('status', 'open')
    .preload('order')
  for (const conversation of orderThreads) {
    if (!isOrderLive(conversation, conversation.order ?? null, now)) {
      const reassigned = conversation.order && conversation.order.vendorId !== conversation.vendorId
      await closeConversation(conversation, reassigned ? 'reassigned' : 'order_closed')
      closed++
    }
  }

  return closed
}
