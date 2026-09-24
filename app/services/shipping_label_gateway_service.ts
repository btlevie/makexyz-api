/**
 * Shipping label purchase, abstracted behind one interface so shipment logic
 * doesn't depend on EasyPost directly. Labels are bought on MakeXYZ's own
 * EasyPost account, for instant-quote orders only (see shipment_service.ts).
 *
 * Creating a shipment and buying it are deliberately separate calls: the
 * provider shipment id is persisted between them, so a buy that succeeds at
 * EasyPost but fails on our side (timeout, DB error) can be recovered with
 * getPurchasedLabel instead of buying a second label.
 *
 * In test env this always resolves to the in-memory FakeShippingLabelGateway,
 * same pattern as getPaymentGateway.
 */
import env from '#start/env'
import { EasyPostShippingLabelGateway } from '#services/easypost_shipping_label_gateway'
import { selectLabelRate, type CarrierRate, type ShippingMethod } from '#services/shipping_service'

export type LabelAddress = {
  name: string
  company?: string | null
  street1: string
  street2?: string | null
  city: string
  state?: string | null
  zip: string
  /** ISO-3166 alpha-2. */
  country: string
  phone?: string | null
  email?: string | null
}

export type LabelParcel = {
  weightOz: number
  lengthIn: number
  widthIn: number
  heightIn: number
}

export type LabelCustomsItem = {
  description: string
  quantity: number
  /** Total declared value of this line in dollars (not per unit), as EasyPost expects. */
  value: number
  weightOz: number
  hsTariffNumber?: string | null
  originCountry: string
}

export type CreateLabelShipmentParams = {
  toAddress: LabelAddress
  fromAddress: LabelAddress
  returnAddress: LabelAddress
  parcel: LabelParcel
  /** Required by carriers for international shipments; null for domestic. */
  customs: { signer: string; items: LabelCustomsItem[] } | null
  /** Printed on the label where the carrier supports it (the order number). */
  reference: string
}

export type PurchasedLabel = {
  providerShipmentId: string
  rateId: string
  carrier: string
  service: string
  trackingCode: string
  trackingUrl: string | null
  labelUrl: string
  labelPdfUrl: string | null
  labelFormat: string
  /** Decimal string, dollars. */
  cost: string
}

export type LabelRefundStatus = 'submitted' | 'refunded' | 'rejected'

export interface ShippingLabelGateway {
  createShipment(params: CreateLabelShipmentParams): Promise<{ providerShipmentId: string }>
  buyShipment(providerShipmentId: string, method: ShippingMethod): Promise<PurchasedLabel>
  /** The label already bought for this shipment, or null if it was never bought. */
  getPurchasedLabel(providerShipmentId: string): Promise<PurchasedLabel | null>
  refundLabel(providerShipmentId: string): Promise<{ refundStatus: LabelRefundStatus }>
}

export class ShippingLabelGatewayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShippingLabelGatewayError'
  }
}

/** No carrier rate satisfies the order's paid-for shipping method. */
export class NoMatchingRateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoMatchingRateError'
  }
}

type FakeShipment = {
  params: CreateLabelShipmentParams
  purchased: PurchasedLabel | null
  refundStatus: LabelRefundStatus | null
}

const FAKE_RATES: CarrierRate[] = [
  { id: 'rate_fake_usps_ground', carrier: 'USPS', service: 'GroundAdvantage', rate: '7.50' },
  { id: 'rate_fake_usps_priority', carrier: 'USPS', service: 'Priority', rate: '9.10' },
  { id: 'rate_fake_ups_2day', carrier: 'UPS', service: '2ndDayAir', rate: '24.00' },
  { id: 'rate_fake_ups_overnight', carrier: 'UPS', service: 'NextDayAir', rate: '61.00' },
  { id: 'rate_fake_ups_expedited', carrier: 'UPS', service: 'Expedited', rate: '45.00' },
]

/**
 * In-memory stand-in used in test env - deterministic, no network calls. The
 * public toggles let tests simulate each failure mode shipment_service has to
 * handle.
 */
export class FakeShippingLabelGateway implements ShippingLabelGateway {
  shipments = new Map<string, FakeShipment>()
  /** Number of successful purchases - lets tests assert a retry didn't buy twice. */
  purchaseCount = 0
  lastCreateParams: CreateLabelShipmentParams | null = null

  failNextCreate = false
  /** The next buy succeeds at the "provider" but then throws, like a timeout after purchase. */
  failNextBuyAfterPurchase = false
  /** Every rate list comes back empty (e.g. carrier account not enabled). */
  noRates = false

  private nextId = 1

  /** Test-only: clears all state between tests. */
  reset(): void {
    this.shipments.clear()
    this.purchaseCount = 0
    this.lastCreateParams = null
    this.failNextCreate = false
    this.failNextBuyAfterPurchase = false
    this.noRates = false
    this.nextId = 1
  }

  async createShipment(params: CreateLabelShipmentParams): Promise<{ providerShipmentId: string }> {
    if (this.failNextCreate) {
      this.failNextCreate = false
      throw new ShippingLabelGatewayError('Fake create failure')
    }
    const providerShipmentId = `shp_fake_${this.nextId++}`
    this.shipments.set(providerShipmentId, { params, purchased: null, refundStatus: null })
    this.lastCreateParams = params
    return { providerShipmentId }
  }

  async buyShipment(providerShipmentId: string, method: ShippingMethod): Promise<PurchasedLabel> {
    const shipment = this.getShipment(providerShipmentId)
    if (shipment.purchased) {
      throw new ShippingLabelGatewayError(`Shipment ${providerShipmentId} was already purchased`)
    }

    const rate = selectLabelRate(this.noRates ? [] : FAKE_RATES, method)
    if (!rate) {
      throw new NoMatchingRateError(`No carrier rate available for shipping method "${method}"`)
    }

    const trackingCode = `EZFAKE${providerShipmentId.replace('shp_fake_', '').padStart(8, '0')}`
    shipment.purchased = {
      providerShipmentId,
      rateId: rate.id,
      carrier: rate.carrier,
      service: rate.service,
      trackingCode,
      trackingUrl: `https://track.example.test/${trackingCode}`,
      labelUrl: `https://labels.example.test/${providerShipmentId}.png`,
      labelPdfUrl: `https://labels.example.test/${providerShipmentId}.pdf`,
      labelFormat: 'PDF',
      cost: rate.rate,
    }
    this.purchaseCount++

    if (this.failNextBuyAfterPurchase) {
      this.failNextBuyAfterPurchase = false
      throw new ShippingLabelGatewayError('Fake failure after purchase')
    }

    return shipment.purchased
  }

  async getPurchasedLabel(providerShipmentId: string): Promise<PurchasedLabel | null> {
    return this.getShipment(providerShipmentId).purchased
  }

  async refundLabel(providerShipmentId: string): Promise<{ refundStatus: LabelRefundStatus }> {
    const shipment = this.getShipment(providerShipmentId)
    if (!shipment.purchased) {
      throw new ShippingLabelGatewayError(`Shipment ${providerShipmentId} has no label to refund`)
    }
    shipment.refundStatus = 'submitted'
    return { refundStatus: 'submitted' }
  }

  private getShipment(providerShipmentId: string): FakeShipment {
    const shipment = this.shipments.get(providerShipmentId)
    if (!shipment) {
      throw new ShippingLabelGatewayError(`Unknown shipment ${providerShipmentId}`)
    }
    return shipment
  }
}

export const fakeShippingLabelGateway = new FakeShippingLabelGateway()

export function getShippingLabelGateway(): ShippingLabelGateway {
  if (env.get('NODE_ENV') === 'test') {
    return fakeShippingLabelGateway
  }
  return new EasyPostShippingLabelGateway()
}
