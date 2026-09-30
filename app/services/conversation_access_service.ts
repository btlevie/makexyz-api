/**
 * Who may see which conversation. Same stance as project_grant_service.ts:
 * resolvers return null rather than throwing, and callers 404 - never
 * revealing whether someone else's conversation exists.
 *
 * - A customer sees conversations where they're the customer participant.
 *   Guests have no login, so they must create or claim an account first.
 * - A vendor sees conversations where they're the vendor participant, but an
 *   inquiry only once the customer's first message has been delivered, and an
 *   order thread only while the order is still assigned to them (a
 *   reassigned order cuts off the previous vendor).
 * - An admin sees everything, read-only (staff participants come later).
 */
import type { HttpContext } from '@adonisjs/core/http'
import Conversation from '#models/conversation'
import ConversationParticipant from '#models/conversation_participant'
import Customer from '#models/customer'
import Order from '#models/order'
import type Vendor from '#models/vendor'
import { resolveVendor } from '#services/vendor_onboarding_service'

/** Vendor statuses that can use messaging - a suspended vendor still finishes live orders. */
const MESSAGING_VENDOR_STATUSES: Vendor['status'][] = ['active', 'suspended']

export type Viewer =
  | { kind: 'customer'; customer: Customer }
  | { kind: 'vendor'; vendor: Vendor }
  | { kind: 'admin' }

export interface ConversationAccess {
  conversation: Conversation
  viewer: Viewer
  /** Null for admins, who view without being a participant. */
  participant: ConversationParticipant | null
}

/** The caller as a messaging principal, or null if they have no messaging access at all. */
export async function resolveViewer(ctx: HttpContext): Promise<Viewer | null> {
  const user = ctx.auth.user
  if (!user) {
    return null
  }
  if (user.role === 'admin') {
    return { kind: 'admin' }
  }
  if (user.role === 'customer') {
    const customer = await Customer.findBy('userId', user.id)
    return customer ? { kind: 'customer', customer } : null
  }
  if (user.role === 'vendor') {
    const vendor = await resolveVendor(ctx)
    return vendor && MESSAGING_VENDOR_STATUSES.includes(vendor.status)
      ? { kind: 'vendor', vendor }
      : null
  }
  return null
}

/** Whether a vendor may currently see this conversation (see the module comment). */
async function vendorCanSee(conversation: Conversation, vendor: Vendor): Promise<boolean> {
  if (conversation.vendorId !== vendor.id) {
    return false
  }
  if (conversation.kind === 'inquiry' && !conversation.firstCustomerMessageDeliveredAt) {
    return false
  }
  if (conversation.kind === 'order') {
    const order = conversation.orderId ? await Order.find(conversation.orderId) : null
    return !!order && order.vendorId === vendor.id
  }
  return true
}

export async function resolveConversation(
  ctx: HttpContext,
  conversationUuid: string
): Promise<ConversationAccess | null> {
  const viewer = await resolveViewer(ctx)
  if (!viewer) {
    return null
  }
  const conversation = await Conversation.findBy('uuid', conversationUuid)
  if (!conversation) {
    return null
  }

  if (viewer.kind === 'admin') {
    return { conversation, viewer, participant: null }
  }

  if (viewer.kind === 'customer') {
    const participant = await ConversationParticipant.query()
      .where('conversationId', conversation.id)
      .where('role', 'customer')
      .where('customerId', viewer.customer.id)
      .first()
    return participant ? { conversation, viewer, participant } : null
  }

  if (!(await vendorCanSee(conversation, viewer.vendor))) {
    return null
  }
  const participant = await ConversationParticipant.query()
    .where('conversationId', conversation.id)
    .where('role', 'vendor')
    .where('vendorId', viewer.vendor.id)
    .first()
  return participant ? { conversation, viewer, participant } : null
}

/** The conversations a customer or vendor may list (admins use the admin endpoints). */
export async function listConversationsFor(viewer: Viewer): Promise<Conversation[]> {
  const query = Conversation.query().orderByRaw('coalesce(last_message_at, created_at) desc')
  if (viewer.kind === 'customer') {
    query.where('customerId', viewer.customer.id)
  } else if (viewer.kind === 'vendor') {
    query
      .where('vendorId', viewer.vendor.id)
      .where((inner) =>
        inner.whereNot('kind', 'inquiry').orWhereNotNull('firstCustomerMessageDeliveredAt')
      )
      .where((inner) =>
        inner
          .whereNot('kind', 'order')
          .orWhereHas('order', (orders) => orders.where('vendorId', viewer.vendor.id))
      )
  } else {
    return []
  }
  return query
}
