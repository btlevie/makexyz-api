/**
 * Splits a quote flagged `needs_review` (see quote_generation_service.ts)
 * into two or more resulting quotes, one per admin-specified group of
 * items - so each can independently route to a vendor capable of just its
 * own subset. Happens entirely before checkout: each resulting quote goes
 * through the ordinary, unmodified configure -> accept -> checkout -> order
 * pipeline on its own, so there's no shared payment to reason about.
 */
import string from '@adonisjs/core/helpers/string'
import db from '@adonisjs/lucid/services/db'
import Address from '#models/address'
import AuditEvent from '#models/audit_event'
import Quote from '#models/quote'
import type QuoteItem from '#models/quote_item'
import { roundCurrency } from '#services/fdm_pricing_calculator'
import { hasAnyCapableVendor } from '#services/order_routing_service'
import {
  computeShippingProductionAndTax,
  QuoteNotConfigurableError,
  type QuoteReviewReason,
} from '#services/quote_generation_service'

export class InvalidSplitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSplitError'
  }
}

const UNFULFILLABLE_REASON: QuoteReviewReason = 'unfulfillable_technology_mix'

function subtotalOf(items: QuoteItem[]): number {
  return roundCurrency(items.reduce((sum, item) => sum + Number(item.total), 0))
}

/**
 * Splits `quote` into `groups.length` resulting quotes, one per group of
 * ProjectFile uuids. The first group reuses `quote`'s own identity
 * (trimmed to that group's items); every other group becomes a brand new
 * quote. Every resulting quote independently gets re-checked for
 * fulfillability and, if fulfillable and already configured (destination/
 * shipping/production-time carried forward from the original), real
 * pricing computed against just its own items - not a proportional share
 * of the original's.
 */
export async function splitQuote(
  quote: Quote,
  groups: string[][],
  adminUserId: number
): Promise<Quote[]> {
  if (quote.status !== 'needs_review') {
    throw new QuoteNotConfigurableError(`Quote ${quote.uuid} is not awaiting review`)
  }
  if (groups.length < 2) {
    throw new InvalidSplitError('A split needs at least 2 groups')
  }

  await quote.load('items', (q) => q.preload('projectFile'))

  const itemsByProjectFileUuid = new Map<string, QuoteItem>()
  for (const item of quote.items) {
    if (item.projectFile) {
      itemsByProjectFileUuid.set(item.projectFile.uuid, item)
    }
  }

  const seen = new Set<string>()
  const groupItems: QuoteItem[][] = []
  for (const group of groups) {
    if (group.length === 0) {
      throw new InvalidSplitError('Every group must have at least one item')
    }
    const items: QuoteItem[] = []
    for (const projectFileUuid of group) {
      const item = itemsByProjectFileUuid.get(projectFileUuid)
      if (!item) {
        throw new InvalidSplitError(`Project file ${projectFileUuid} is not on this quote`)
      }
      if (seen.has(projectFileUuid)) {
        throw new InvalidSplitError(`Project file ${projectFileUuid} appears in more than one group`)
      }
      seen.add(projectFileUuid)
      items.push(item)
    }
    groupItems.push(items)
  }
  if (seen.size !== itemsByProjectFileUuid.size) {
    throw new InvalidSplitError('Every item on the quote must be assigned to a group')
  }

  // Every group's fulfillability (and, when configured, real pricing) is
  // resolved BEFORE opening the write transaction below, not inside it -
  // hasAnyCapableVendor/computeShippingProductionAndTax read through the
  // default (non-transactional) connection, and SQLite (tests) only has one
  // connection to give out, so a plain query issued from inside an open
  // db.transaction() would block forever waiting for a connection the
  // transaction itself is holding. Postgres (dev/prod) tolerates this, but
  // there's no reason to hold the transaction open across these reads
  // anyway - they're pure lookups, not part of what needs to be atomic.
  const isConfigured = Boolean(
    quote.destinationCountry &&
      quote.shippingMethod &&
      quote.productionTimeBusinessDays !== null &&
      quote.addressId
  )
  const address = isConfigured ? await Address.findOrFail(quote.addressId!) : null

  const groupResolutions = await Promise.all(
    groupItems.map(async (items) => {
      const requiredTechnologies = [
        ...new Set(items.map((item) => item.projectFile!.technology)),
      ]
      const fulfillable = await hasAnyCapableVendor(requiredTechnologies)
      if (!fulfillable) {
        return { fulfillable: false as const }
      }
      if (!isConfigured) {
        return { fulfillable: true as const, pricing: null }
      }
      const pricing = await computeShippingProductionAndTax(
        quote.destinationCountry!,
        quote.shippingMethod!,
        quote.productionTimeBusinessDays!,
        subtotalOf(items),
        items,
        {
          line1: address!.line1,
          line2: address!.line2,
          city: address!.city,
          state: address!.state,
          postalCode: address!.postalCode,
        }
      )
      return { fulfillable: true as const, pricing }
    })
  )

  return db.transaction(async (trx) => {
    const resultingQuotes: Quote[] = [quote]

    // Group 0 reuses the original quote's identity - its items already
    // belong to it, so only the subtotal (over its now-possibly-smaller
    // item set) needs recomputing.
    quote.useTransaction(trx)
    quote.subtotal = subtotalOf(groupItems[0]).toFixed(2)

    // Groups 1..N-1 each get a brand new quote, carrying forward whatever
    // the customer already configured on the original (or null, if they
    // haven't configured anything yet) - repointing their items' quote_id,
    // not recreating them (still the same immutable pricing snapshots).
    for (let i = 1; i < groupItems.length; i++) {
      const items = groupItems[i]
      const newQuote = await Quote.create(
        {
          uuid: string.uuid(),
          projectId: quote.projectId,
          createdById: quote.createdById,
          originQuoteId: null,
          revision: 1,
          subtotal: subtotalOf(items).toFixed(2),
          tax: '0.00',
          total: subtotalOf(items).toFixed(2),
          status: 'draft',
          generatedBy: quote.generatedBy,
          destinationCountry: quote.destinationCountry,
          shippingMethod: quote.shippingMethod,
          // Explicit null, not omitted - an omitted column leaves the
          // in-memory instance's field as `undefined` rather than a real
          // null, which a caller serializing this same instance later
          // (without a DB round-trip) would see instead of null. Same
          // reasoning as persistQuote's addressId.
          shippingFeeAmount: null,
          productionTimeBusinessDays: quote.productionTimeBusinessDays,
          productionTimeFeeAmount: null,
          stripeTaxCalculationId: null,
          addressId: quote.addressId,
        },
        { client: trx }
      )
      for (const item of items) {
        item.useTransaction(trx)
        item.quoteId = newQuote.id
        await item.save()
      }
      resultingQuotes.push(newQuote)
    }

    // Apply each group's already-resolved fulfillability/pricing - a group
    // might still be unfulfillable (lets admin split in multiple passes for
    // a 3+-technology mix), or fulfillable and ready for real pricing.
    for (let i = 0; i < resultingQuotes.length; i++) {
      const resultQuote = resultingQuotes[i]
      const resolution = groupResolutions[i]
      resultQuote.useTransaction(trx)

      if (!resolution.fulfillable) {
        resultQuote.status = 'needs_review'
        resultQuote.reviewReason = UNFULFILLABLE_REASON
        await resultQuote.save()
        continue
      }

      if (resolution.pricing) {
        resultQuote.tax = resolution.pricing.taxAmount.toFixed(2)
        resultQuote.total = resolution.pricing.total.toFixed(2)
        resultQuote.shippingFeeAmount = resolution.pricing.shippingFeeAmount.toFixed(2)
        resultQuote.productionTimeFeeAmount = resolution.pricing.productionTimeFeeAmount.toFixed(2)
        resultQuote.stripeTaxCalculationId = resolution.pricing.stripeTaxCalculationId
      }

      resultQuote.status = 'draft'
      resultQuote.reviewReason = null
      await resultQuote.save()
    }

    const allUuids = resultingQuotes.map((q) => q.uuid)
    for (const resultQuote of resultingQuotes) {
      await AuditEvent.create(
        {
          entityType: 'quote',
          entityId: resultQuote.id,
          eventType: 'updated',
          userId: adminUserId,
          payload: {
            reason: 'quote_split',
            splitQuoteUuids: allUuids.filter((uuid) => uuid !== resultQuote.uuid),
          },
        },
        { client: trx }
      )
    }

    return resultingQuotes
  }).then(async (resultingQuotes) => {
    // The original quote's `items` snapshot (loaded before the split) is now
    // stale - some items moved out to other groups - and the new quotes
    // never had `items`/`address` preloaded at all. Reload both on every
    // resulting quote so callers get fully-usable instances back.
    for (const resultQuote of resultingQuotes) {
      await resultQuote.load('items')
      await resultQuote.load('address')
    }
    return resultingQuotes
  })
}
